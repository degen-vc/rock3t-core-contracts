// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
import "@openzeppelin/contracts/access/Ownable.sol";
import "./facades/RocketTokenLike.sol";
import "./facades/FeeDistributorLike.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

contract LiquidVault is Ownable {

    event EthereumDeposited(
        address from, 
        address to, 
        uint256 amount, 
        uint256 percentageAmount
    );

    event EthereumSwapped(
        uint256 ethAmount,
        uint256 tokenBalanceAfter,
        address from
    );

    /*
    * A user can hold multiple locked LP batches.
    * Each batch takes 30 days to incubate
    */
    event LPQueued(
        address holder,
        uint256 amount,
        uint256 eth,
        uint256 token,
        uint256 timeStamp
    );

    event LPClaimed(
        address holder,
        uint256 amount,
        uint256 timestamp,
        uint256 exitfee
    );

    struct LPbatch {
        address holder;
        uint256 amount;
        uint256 timestamp;
    }

    struct liquidVaultConfig {
        address tokenAddress;
        IUniswapV2Router02 uniswapRouter;
        IUniswapV2Pair tokenPair;
        FeeDistributorLike feeDistributor;
        address self;
        address weth;
        address payable ethReceiver;
        uint32 stakeDuration;
        uint8 donationShare; //0-100
        uint8 purchaseFee; //0-100
    }

    bool private locked;
    modifier lock {
        require(!locked, "LiquidVault: reentrancy violation");
        locked = true;
        _;
        locked = false;
    }

    liquidVaultConfig public config;
    //Front end can loop through this and inspect if enough time has passed
    mapping(address => LPbatch[]) public LockedLP;

    function seed(
        uint32 duration,
        address _tokenAddress,
        address feeDistributor,
        address payable ethReceiver,
        uint8 donationShare, // LP Token
        uint8 purchaseFee // ETH
    ) public onlyOwner {
        config.tokenAddress = _tokenAddress;
        config.uniswapRouter = IUniswapV2Router02(
            RocketTokenLike(_tokenAddress).uniswapRouter()
        );
        config.tokenPair = IUniswapV2Pair(
            RocketTokenLike(_tokenAddress).tokenUniswapPair()
        );
        config.feeDistributor = FeeDistributorLike(feeDistributor);
        config.weth = config.uniswapRouter.WETH();
        config.self = address(this);
        setEthFeeAddress(ethReceiver);
        setParameters(duration, donationShare, purchaseFee);
    }

    function calculateTokensRequired(uint256 value)
        public
        view
        returns (uint256 feeValue, uint256 exchangeValue, uint256 tokensRequired)
    {
        feeValue = config.purchaseFee * value / 100;
        exchangeValue = value - feeValue;

        (address token0, ) = config.tokenAddress < config.weth
            ? (config.tokenAddress, config.weth)
            : (config.weth, config.tokenAddress);
        (uint256 reserve1, uint256 reserve2, ) = config.tokenPair.getReserves();
        tokensRequired = 0;

        if (config.tokenPair.totalSupply() == 0) {
            tokensRequired = RocketTokenLike(config.tokenAddress).balanceOf(
                address(this)
            );
        } else if (token0 == config.tokenAddress) {
            tokensRequired = config.uniswapRouter.quote(
                exchangeValue,
                reserve2,
                reserve1
            );
        } else {
            tokensRequired = config.uniswapRouter.quote(
                exchangeValue,
                reserve1,
                reserve2
            );
        }
    }

    function setEthFeeAddress(address payable ethReceiver)
        public
        onlyOwner
    {
        require(
            ethReceiver != address(0),
            "LiquidVault: eth receiver is zero address"
        );

        config.ethReceiver = ethReceiver;
    }

    function setParameters(uint32 duration, uint8 donationShare, uint8 purchaseFee)
        public
        onlyOwner
    {
        require(
            donationShare <= 100,
            "LiquidVault: donation share % between 0 and 100"
        );
        require(
            purchaseFee <= 100,
            "LiquidVault: purchase fee share % between 0 and 100"
        );

        config.stakeDuration = duration * 1 days;
        config.donationShare = donationShare;
        config.purchaseFee = purchaseFee;
    }

    function purchaseLPFor(address beneficiary) public payable lock {
        config.feeDistributor.distributeFees();
        require(msg.value > 0, "LiquidVault: eth required to mint tokens LP");

        (uint256 feeValue, uint256 exchangeValue, uint256 tokensRequired) = calculateTokensRequired(msg.value);

        uint256 balance = RocketTokenLike(config.tokenAddress).balanceOf(config.self);
        require(
            balance >= tokensRequired,
            "LiquidVault: insufficient tokens in LiquidVault"
        );

        IWETH(config.weth).deposit{ value: exchangeValue }();
        address tokenPairAddress = address(config.tokenPair);
        IWETH(config.weth).transfer(tokenPairAddress, exchangeValue);
        RocketTokenLike(config.tokenAddress).transfer(
            tokenPairAddress,
            tokensRequired
        );
        // config.ethReceiver.transfer(feeValue);
        _swapETHForTokens(config.tokenAddress, feeValue, 0, block.timestamp);
        uint256 liquidityCreated = config.tokenPair.mint(config.self);

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
            exchangeValue,
            tokensRequired,
            block.timestamp
        );

        emit EthereumDeposited(msg.sender, config.ethReceiver, exchangeValue, feeValue);
    }

    //send eth to match with HCORE tokens in LiquidVault
    function purchaseLP() public payable {
        this.purchaseLPFor{ value: msg.value }(msg.sender);
    }

    //pops latest LP if older than period
    function claimLP() public returns (bool) {
        uint256 length = LockedLP[msg.sender].length;
        require(length > 0, "LiquidVault: No locked LP.");
        LPbatch memory batch = LockedLP[msg.sender][length - 1];
        require(
            block.timestamp - batch.timestamp > config.stakeDuration,
            "LiquidVault: LP still locked."
        );
        LockedLP[msg.sender].pop();
        uint256 donation = (config.donationShare * batch.amount) / 100;
        emit LPClaimed(msg.sender, batch.amount, block.timestamp, donation);
        require(
            config.tokenPair.transfer(address(0), donation),
            "LiquidVault: donation transfer failed in LP claim."
        );
        return config.tokenPair.transfer(batch.holder, batch.amount - donation);
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

    function _swapETHForTokens(address _token, uint _amountIn, uint _amountOutMin, uint _deadline)
        internal
    {
        address[] memory path = new address[](2);
        path[0] = address(_token);
        path[1] = config.uniswapRouter.WETH();
        config.uniswapRouter.swapExactETHForTokensSupportingFeeOnTransferTokens{value: _amountIn}(
            _amountOutMin,
            path,
            address(this),
            _deadline
        );
        uint256 tokenBalanceAfterSwap = RocketTokenLike(config.tokenAddress).balanceOf(address(this));

        emit EthereumSwapped(_amountIn, tokenBalanceAfterSwap, msg.sender);
    }
}
