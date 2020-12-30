// SPDX-License-Identifier: MIT
pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./facades/FeeDistributorLike.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import '@uniswap/v2-periphery/contracts/libraries/UniswapV2OracleLibrary.sol';

contract LiquidVault is Ownable {
    using SafeMath for uint256;

    liquidVaultConfig public config;

    uint256 public globalLPLockTime;
    address public treasury;
    LockTimeConstants public CONSTANTS;
    mapping(address => LPbatch[]) public LockedLP;

    bool private unlocked;

    struct LPbatch {
        address holder;
        uint256 amount;
        uint256 timestamp;
    }

    struct liquidVaultConfig {
        address R3T;
        IUniswapV2Router02 uniswapRouter;
        IUniswapV2Pair tokenPair;
        FeeDistributorLike feeDistributor;
        address self;
        address weth;
        uint8 blackHoleShare; //0-100
        uint8 ethFeePercentage;
    }

    struct LockTimeConstants {
        int scalingWet;
        int shiftWet;
        int scalingDry;
        int shiftDry;
        uint minLockTime;
    }

    struct PurchaseLPVariables {
        uint ethFee;
        uint netEth;
        uint reserve1;
        uint reserve2;
    }

    /*
        A user can hold multiple locked LP batches. Each batch takes 30 days to incubate
    */
    event LPQueued(
        address holder,
        uint256 amount,
        uint256 eth,
        uint256 r3t,
        uint256 timeStamp
    );

    event LPClaimed(
        address holder,
        uint256 amount,
        uint256 timestamp,
        uint blackholeDonation
    );

    constructor() {
        CONSTANTS.scalingWet = 11344;
        CONSTANTS.shiftWet = -3;
        CONSTANTS.scalingDry = -191;
        CONSTANTS.shiftDry = -217;
        CONSTANTS.minLockTime = 1;
        unlocked = true;
    }

    modifier lock {
        require(unlocked, "R3T: reentrancy violation");
        unlocked = false;
        _;
        unlocked = true;
    }

    //L = (scalingWet/(mwet + shiftWet)) + (scalingDy/(mdry +shiftDry)) + C
    //mwet = eth value of tokens in liquidvault
    //mdry = eth in uniswap pool
    modifier updateLockTime {
        _calculateLockPeriod();
        _;
    }

    function seed(
        address r3t,
        address feeDistributor,
        uint8 blackHoleShare,
        address uniswapRouter,
        address uniswapPair,
        uint8 ethFeePercentage,
        address _treasury
    ) public onlyOwner {
        require(ethFeePercentage <= 40, "R3T: eth fee cannot exceed 40%");

        config.R3T = r3t;
        config.feeDistributor = FeeDistributorLike(feeDistributor);
        config.tokenPair = IUniswapV2Pair(uniswapPair);
        config.uniswapRouter = IUniswapV2Router02(uniswapRouter);
        config.weth = config.uniswapRouter.WETH();
        config.self = address(this);
        config.blackHoleShare = blackHoleShare;
        config.ethFeePercentage = ethFeePercentage;
        treasury = _treasury;
    }

    function setLockedPeriod(uint256 durationMin) external onlyOwner {
        globalLPLockTime = durationMin * 1 minutes;
    }

    function getLockedPeriod() external view returns (uint256) {
        return _calculateLockPeriod();
    }

    function getLPBurnPercentage() external view returns (uint256) {
        return config.blackHoleShare;
    }

    function getCurrentTokenPrice() external view returns (uint256) {
        (uint256 _price0Cumulative, uint256 _price1Cumulative, uint32 _blockTimestamp) =
            UniswapV2OracleLibrary.currentCumulativePrices(address(config.tokenPair));

        (address token0, ) = config.R3T < config.weth
            ? (config.R3T, config.weth)
            : (config.weth, config.R3T);

        if (token0 == config.R3T) {
            return _price0Cumulative;
        } else {
            return _price1Cumulative;
        }
    }

    function flushToTreasury(uint amount) public onlyOwner {
        require(treasury != address(0),"R3T: treasury not set");
        IERC20(config.R3T).transfer(treasury,amount);
    }

    function setLockTimeConstants(
        int scalingWet,
        int shiftWet,
        int scalingDry,
        int shiftDry,
        uint minLockTime
    ) public onlyOwner {
        CONSTANTS.scalingWet = scalingWet;
        CONSTANTS.shiftWet = shiftWet;
        CONSTANTS.scalingDry = scalingDry;
        CONSTANTS.shiftDry = shiftDry;
        CONSTANTS.minLockTime = minLockTime;
    }

    function purchaseLPFor(address beneficiary) public payable lock updateLockTime {
        config.feeDistributor.distributeFees();
        require(msg.value > 0, "R3T: eth required to mint R3T LP");
        PurchaseLPVariables memory VARS;
        VARS.ethFee = msg.value.mul(config.ethFeePercentage).div(1000);
        VARS.netEth = msg.value.sub(VARS.ethFee);

        (address token0, ) = config.R3T < config.weth
            ? (config.R3T, config.weth)
            : (config.weth, config.R3T);
             uint256 r3tRequired = 0;

            (VARS.reserve1,VARS.reserve2, ) = config.tokenPair.getReserves();

            if (token0 == config.R3T) {
                r3tRequired = config.uniswapRouter.quote(
                    VARS.netEth,
                    VARS.reserve2,
                    VARS.reserve1
                );
            } else {
                r3tRequired = config.uniswapRouter.quote(VARS.netEth, VARS.reserve1, VARS.reserve2);
            }

        uint256 balance = IERC20(config.R3T).balanceOf(config.self);
        require(balance >= r3tRequired, "R3T: insufficient R3T in LiquidVault");

        IWETH(config.weth).deposit{value: VARS.netEth}();
        address tokenPairAddress = address(config.tokenPair);
        IWETH(config.weth).transfer(tokenPairAddress, VARS.netEth);
        IERC20(config.R3T).transfer(tokenPairAddress, r3tRequired);


        uint256 liquidityCreated = config.tokenPair.mint(config.self);

        {
            address[] memory path = new address[](2);
            path[0] = config.weth;
            path[1] = config.R3T;

            config.uniswapRouter.swapExactETHForTokens{ value:VARS.ethFee }(
                0,
                path,
                address(this),
                7258118400
            );
        }


        LockedLP[beneficiary].push(
            LPbatch({
                holder: beneficiary,
                amount: liquidityCreated,
                timestamp: block.timestamp
            })
        );

        emit LPQueued(
            beneficiary,
            liquidityCreated,
            VARS.netEth,
            r3tRequired,
            block.timestamp
        );
    }

    //send eth to match with HCORE tokens in LiquidVault
    function purchaseLP() public payable {
        this.purchaseLPFor{value: msg.value}(msg.sender);
    }

    //pops latest LP if older than period
    function claimLP() public updateLockTime returns (bool)  {
        uint256 length = LockedLP[msg.sender].length;
        require(length > 0, "R3T: No locked LP.");
        LPbatch memory batch = LockedLP[msg.sender][length - 1];
        require(
            block.timestamp - batch.timestamp > globalLPLockTime,
            "R3T: LP still locked."
        );
        LockedLP[msg.sender].pop();
        uint blackholeDonation = (config.blackHoleShare * batch.amount).div(1000);
        emit LPClaimed(msg.sender, batch.amount, block.timestamp, blackholeDonation);
        config.tokenPair.transfer(address(0), blackholeDonation);
        return config.tokenPair.transfer(batch.holder, batch.amount-blackholeDonation);
    }

    function lockedLPLength(address holder) public view returns (uint256) {
        return LockedLP[holder].length;
    }

    function getLockedLP(address holder, uint256 position)
        public
        view
        returns (
            address,
            uint256,
            uint256
        )
    {
        LPbatch memory batch = LockedLP[holder][position];
        return (batch.holder, batch.amount, batch.timestamp);
    }

    function _calculateLockPeriod() internal view returns (uint256 globalLPLockTime) {
        // WIP
        globalLPLockTime = 1 days;
        return globalLPLockTime;

        uint R3TinVault = IERC20(config.R3T).balanceOf(address(this));
        uint ethInUniswap = config.tokenPair.balanceOf(address(this));
        (address token0, ) = config.R3T < config.weth
            ? (config.R3T, config.weth)
            : (config.weth, config.R3T);

        uint ethValueOfTokens = 0;
        (uint256 reserve0, uint256 reserve1, ) = config.tokenPair.getReserves();

        if (token0 == config.R3T) {
            ethValueOfTokens = config.uniswapRouter.quote(
                R3TinVault,
                reserve0,
                reserve1
            );
        } else {
            ethValueOfTokens = config.uniswapRouter.quote(R3TinVault, reserve1, reserve0);
        }
        (int mwet, int mdry) = (int(ethValueOfTokens), int(ethInUniswap));
        globalLPLockTime = uint((CONSTANTS.scalingWet / (mwet + CONSTANTS.shiftWet)) + (CONSTANTS.scalingDry / (mdry +CONSTANTS.shiftDry)) + int(CONSTANTS.minLockTime));
    }
}