// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; // for WETH
import "@nomiclabs/buidler/console.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract FeeApprover is Ownable {
    using SafeMath for uint256;

    address tokenUniswapPair;
    address tokenAddress;
    address liquidVault;

    uint8 public feePercentX100;
    bool paused;
    
    mapping(address => uint256) public discountFrom;
    mapping(address => uint256) public discountTo;
    mapping(address => uint256) public feeBlackList;

    function initialize(
        address _tokenAddress,
        address _uniswapFactory,
        address _uniswapRouter,
        address _liquidVault
    ) public onlyOwner {
        tokenAddress = _tokenAddress;

        tokenUniswapPair = IUniswapV2Factory(_uniswapFactory).getPair(
            IUniswapV2Router02(_uniswapRouter).WETH(),
            _tokenAddress
        );
        feePercentX100 = 10;
        paused = true;
        _setFeeDiscountTo(tokenUniswapPair, 1000);
        _setFeeDiscountFrom(tokenUniswapPair, 1000);
        liquidVault = _liquidVault;
    }

    // Once token is unpaused, it can never be paused
    function unPause() public onlyOwner {
        paused = false;
    }

    function setFeeMultiplier(uint8 _feeMultiplier) public onlyOwner {
        require(
            _feeMultiplier <= 100,
            "FeeApprover: percentage expressed as number between 0 and 100"
        );
        feePercentX100 = _feeMultiplier;
    }

    function setFeeBlackList(address _address, uint256 feeAmount)
        public
        onlyOwner
    {
        require(
            feeAmount <= 100,
            "FeeApprover: percentage expressed as number between 0 and 100"
        );
        feeBlackList[_address] = feeAmount;
    }

    function setFeeDiscountTo(address _address, uint256 discount)
        public
        onlyOwner
    {
        _setFeeDiscountTo(_address, discount);
    }

    function _setFeeDiscountTo(address _address, uint256 discount) internal {
        require(
            discount <= 1000,
            "FeeApprover: discount expressed as percentage between 0 and 1000"
        );
        discountTo[_address] = discount;
    }

    function setFeeDiscountFrom(address _address, uint256 discount)
        public
        onlyOwner
    {
        _setFeeDiscountFrom(_address, discount);
    }

    function _setFeeDiscountFrom(address _address, uint256 discount) internal {
        require(
            discount <= 1000,
            "FeeApprover: discount expressed as percentage between 0 and 1000"
        );
        discountFrom[_address] = discount;
    }

    function calculateAmountsAfterFee(
        address sender,
        address recipient,
        uint256 amount
    )
        public
        view
        returns (
            uint256 transferToAmount,
            uint256 transferToFeeDistributorAmount
        )
    {
        require(!paused, "FeeApprover: system not yet initialized");
        uint256 fee;
        if (feeBlackList[sender] > 0) {
            fee = feeBlackList[sender].mul(amount).div(100);
        } else {
            fee = amount.mul(feePercentX100).div(100);
            uint256 totalDiscount = discountFrom[sender].mul(fee).div(1000) +
                discountTo[recipient].mul(fee).div(1000);
            fee = totalDiscount > fee ? 0 : fee - totalDiscount;
        }

        return (amount - fee, fee);
    }
}
