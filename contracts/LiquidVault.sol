// SPDX-License-Identifier: MIT
pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './facades/FeeDistributorLike.sol';
import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';
import '@uniswap/v2-periphery/contracts/interfaces/IWETH.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import '@uniswap/v2-periphery/contracts/libraries/UniswapV2OracleLibrary.sol';
import './UniswapV2Library.sol';
import 'abdk-libraries-solidity/ABDKMathQuad.sol';
import './PriceOracle.sol';

contract LiquidVault is Ownable {
    using SafeMath for uint;
    using ABDKMathQuad for bytes16;

    LiquidVaultConfig public config;
    BuyPressureVariables public calibration;
    LockPercentageVariables public lockPercentageCalibration;

    address public treasury;
    mapping(address => LPbatch[]) public lockedLP;

    bool private locked;

    struct LPbatch {
        address holder;
        uint amount;
        uint timestamp;
    }

    struct LiquidVaultConfig {
        IERC20 R3T;
        IUniswapV2Router02 uniswapRouter;
        IUniswapV2Pair tokenPair;
        FeeDistributorLike feeDistributor;
        PriceOracle uniswapOracle;
        IWETH weth;
    }

    struct PurchaseLPVariables {
        uint ethFee;
        uint netEth;
        uint reserve1;
        uint reserve2;
    }

    struct BuyPressureVariables {
        bytes16 a;
        bytes16 b;
        bytes16 c;
        bytes16 d;
        uint maxReserves;
    }

    struct LockPercentageVariables {
        bytes16 d_max; //maximum lock percentage
        bytes16 P0; //normal price
        bytes16 d0; //normal permanent lock percentage
        bytes16 beta; //Calibration coefficient
    }

    /*
        A user can hold multiple locked LP batches. Each batch takes 30 days to incubate
    */
    event LPQueued(
        address holder,
        uint amount,
        uint eth,
        uint r3t,
        uint timeStamp,
        uint lockPeriod
    );

    event LPClaimed(
        address holder,
        uint amount,
        uint timestamp,
        uint blackholeDonation,
        uint lockPeriod
    );

    constructor() {
        calibrate(
            0xbfcb59e05f1e2674d208f2461d9cb64e, // a = -3e-16
            0x3fde33dcfe54a3802b3e313af8e0e525, // b = 1.4e-10
            0x3ff164840e1719f7f8ca8198f1d3ed52, // c = 8.5e-5
            0x00000000000000000000000000000000, // d = 0
            500000e18 // maxReserves
        );

        calibrateLockPercentage(
            0x40014000000000000000000000000000, // d_max =  5
            0x3ff7cac083126e978d4fdf3b645a1cac, // p0 = 7e-3
            0x40004000000000000000000000000000, // d0 = 2.5
            0x40061db6db6db5a1484ad8a787aa1421 // beta = 142.857142857
        );
    }

    modifier lock {
        require(!locked, 'R3T: reentrancy violation');
        locked = true;
        _;
        locked = false;
    }

    function seed(
        IERC20 r3t,
        FeeDistributorLike _feeDistributor,
        IUniswapV2Router02 _uniswapRouter,
        IUniswapV2Pair _uniswapPair,
        address _treasury,
        PriceOracle _uniswapOracle
    ) public onlyOwner {
        require(address(config.R3T) == address(0), 'Already initiated');
        config.R3T = r3t;
        config.feeDistributor = _feeDistributor;
        config.tokenPair = _uniswapPair;
        config.uniswapRouter = _uniswapRouter;
        config.weth = IWETH(config.uniswapRouter.WETH());
        treasury = _treasury;
        config.uniswapOracle = _uniswapOracle;
    }

    function setOracleAddress(PriceOracle _uniswapOracle) external onlyOwner {
        require(address(_uniswapOracle) != address(0), 'Zero address not allowed');
        config.uniswapOracle = _uniswapOracle;
    }

    function getLockedPeriod() external view returns (uint) {
        return _calculateLockPeriod();
    }

    function flushToTreasury(uint amount) public onlyOwner {
        require(treasury != address(0),'R3T: treasury not set');
        require(config.R3T.transfer(treasury, amount), 'Treasury transfer failed');
    }

    function purchaseLPFor(address beneficiary) public payable lock {
        require(msg.value > 0, 'R3T: eth required to mint R3T LP');
        config.feeDistributor.distributeFees();
        PurchaseLPVariables memory vars;
        uint ethFeePercentage = feeUINT();
        vars.ethFee = msg.value.mul(ethFeePercentage).div(1000);
        vars.netEth = msg.value.sub(vars.ethFee);

        (vars.reserve1, vars.reserve2, ) = config.tokenPair.getReserves();

        uint r3tRequired;
        if (address(config.R3T) < address(config.weth)) {
            r3tRequired = config.uniswapRouter.quote(
                vars.netEth,
                vars.reserve2,
                vars.reserve1
            );
        } else {
            r3tRequired = config.uniswapRouter.quote(
                vars.netEth,
                vars.reserve1,
                vars.reserve2
            );
        }

        uint balance = config.R3T.balanceOf(address(this));
        require(balance >= r3tRequired, 'R3T: insufficient R3T in LiquidVault');

        config.weth.deposit{value: vars.netEth}();
        address tokenPairAddress = address(config.tokenPair);
        config.weth.transfer(tokenPairAddress, vars.netEth);
        config.R3T.transfer(tokenPairAddress, r3tRequired);
        config.uniswapOracle.update();

        uint liquidityCreated = config.tokenPair.mint(address(this));

        if (vars.ethFee > 0) {
            address[] memory path = new address[](2);
            path[0] = address(config.weth);
            path[1] = address(config.R3T);

            config.uniswapRouter.swapExactETHForTokens{ value:vars.ethFee }(
                0,
                path,
                address(this),
                7258118400
            );
        }

        lockedLP[beneficiary].push(
            LPbatch({
                holder: beneficiary,
                amount: liquidityCreated,
                timestamp: block.timestamp
            })
        );

        emit LPQueued(
            beneficiary,
            liquidityCreated,
            vars.netEth,
            r3tRequired,
            block.timestamp,
            _calculateLockPeriod()
        );
    }

    //send eth to match with HCORE tokens in LiquidVault
    function purchaseLP() public payable {
        this.purchaseLPFor{value: msg.value}(msg.sender);
    }

    //pops latest LP if older than period
    function claimLP() public returns (bool)  {
        uint length = lockedLP[msg.sender].length;
        require(length > 0, 'R3T: No locked LP.');
        LPbatch memory batch = lockedLP[msg.sender][length - 1];
        uint globalLPLockTime = _calculateLockPeriod();
        require(
            block.timestamp - batch.timestamp > globalLPLockTime,
            'R3T: LP still locked.'
        );
        lockedLP[msg.sender].pop();
        uint blackHoleShare = lockPercentageUINT();
        uint blackholeDonation = (blackHoleShare * batch.amount).div(100);
        emit LPClaimed(msg.sender, batch.amount, block.timestamp, blackholeDonation, globalLPLockTime);
        config.tokenPair.transfer(address(0), blackholeDonation);
        return config.tokenPair.transfer(batch.holder, batch.amount-blackholeDonation);
    }

    function lockedLPLength(address holder) public view returns (uint) {
        return lockedLP[holder].length;
    }

    function getLockedLP(address holder, uint position)
        public
        view
        returns (
            address,
            uint,
            uint
        )
    {
        LPbatch memory batch = lockedLP[holder][position];
        return (batch.holder, batch.amount, batch.timestamp);
    }

    function _calculateLockPeriod() internal view returns (uint) {
        address factory = address(config.tokenPair.factory());
        (uint etherAmount, uint tokenAmount) = UniswapV2Library.getReserves(factory, address(config.weth), address(config.R3T));
        
        require(etherAmount != 0 && tokenAmount != 0, 'Reserves cannot be zero.');
        
        bytes16 floatEtherAmount = ABDKMathQuad.fromUInt(etherAmount);
        bytes16 floatTokenAmount = ABDKMathQuad.fromUInt(tokenAmount);
        bytes16 systemHealth = floatEtherAmount.mul(floatEtherAmount).div(floatTokenAmount);

        return ABDKMathQuad.toUInt(
            ABDKMathQuad.add(
                ABDKMathQuad.mul(
                    0x4015d556000000000000000000000000, // Lmax - Lmin
                    ABDKMathQuad.exp(
                        ABDKMathQuad.div(
                            systemHealth,
                            0xc03c4a074c14c4eb3800000000000000 // -beta = -2.97263250118e18
                        )
                    )
                ),
                0x400f5180000000000000000000000000 // Lmin
            )
        );
    }

    function calibrate(bytes16 a, bytes16 b, bytes16 c, bytes16 d, uint maxReserves) public onlyOwner {
        calibration.a = a;
        calibration.b = b;
        calibration.c = c;
        calibration.d = d;
        calibration.maxReserves = maxReserves;
    }

    function calibrateLockPercentage(bytes16 d_max, bytes16 P0, bytes16 d0, bytes16 beta) public onlyOwner {
        lockPercentageCalibration.d_max = d_max;
        lockPercentageCalibration.P0 = P0;
        lockPercentageCalibration.d0 = d0;
        lockPercentageCalibration.beta = beta;
    }

    function square(bytes16 number) internal pure returns (bytes16) {
        return number.mul(number);
    }

    function cube(bytes16 number) internal pure returns (bytes16) {
        return square(number).mul(number);
    }

    function fee() public view returns (bytes16) {
        uint tokensInUniswapUint = config.R3T.balanceOf(address(config.tokenPair));

        if (tokensInUniswapUint >= calibration.maxReserves) {
            return 0x40044000000000000000000000000000; // 40%
        }
        bytes16 tokensInUniswap = ABDKMathQuad.fromUInt(tokensInUniswapUint).div(ABDKMathQuad.fromUInt(1e18));

        bytes16 t_squared = square(tokensInUniswap);
        bytes16 t_cubed = cube(tokensInUniswap);

        bytes16 term1 = calibration.a.mul(t_cubed);
        bytes16 term2 = calibration.b.mul(t_squared);
        bytes16 term3 = calibration.c.mul(tokensInUniswap);
        return term1.add(term2).add(term3).add(calibration.d);
    }

    function feeUINT() public view returns (uint) {
        uint multiplier = 10;
        return fee().mul(ABDKMathQuad.fromUInt(multiplier)).toUInt();
    }

    function _calculateLockPercentage() internal view returns (bytes16) {
        //d = d_max*(1/(b.p+1));
        bytes16 ONE = ABDKMathQuad.fromUInt(uint(1));
        bytes16 price = ABDKMathQuad.fromUInt(config.uniswapOracle.consult()).div(
            0x403abc16d674ec800000000000000000 // 1e18
        );
        bytes16 denominator = lockPercentageCalibration.beta.mul(price).add(ONE);
        bytes16 factor = ONE.div(denominator);
        return lockPercentageCalibration.d_max.mul(factor);
    }

    function lockPercentageUINT() public view returns (uint) {
        return _calculateLockPercentage().toUInt();
    }
}