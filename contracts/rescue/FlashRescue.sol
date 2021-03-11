// SPDX-License-Identifier: MIT
pragma solidity ^0.7.1;
import "./LiquidVaultFacade.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../RocketToken.sol";
import "../PriceOracle.sol";
import "./BadOracle.sol";

contract FlashRescue is Ownable {
    LiquidVaultFacade public LV;
    RocketToken public rocketToken;
    address badOracle;

    struct LVconfigBefore {
        RocketToken rocket;
        address uniswapOracle;
        bool seeded;
    }

    enum Step { Unpurchased, Purchased, FinishedClaiming, Withdrawn }

    Step public currentStep;

    LVconfigBefore public LV_config_before;

    constructor() public {
        badOracle = address(new BadOracle());
    }

    function captureConfig(
        RocketToken rocket,
        address uniswapOracle
    ) public onlyOwner {
        LV_config_before.rocket = RocketToken(rocket);
        LV_config_before.uniswapOracle = uniswapOracle;
        LV_config_before.seeded = true;
        _disableLV();
    }

    modifier allAboveBoard {
        require(
            owner() == msg.sender || address(this) == msg.sender,
            "FLASHRESCUE: owner violation."
        );
        require(
            LV_config_before.seeded,
            "FLASHRESCUE: LV configuration not captured."
        );
        _enableLV();
        _;
        _disableLV();
    }

    function seed(address liquidVault) public payable onlyOwner {
        LV = LiquidVaultFacade(liquidVault);
        require(
            Ownable(LV).owner() == address(this),
            "FLASH_RESCUE: transfer ownership of LV"
        );
        require(msg.value > 0, "FLASHRESCUE: I must have eth");
    }

    function returnOwnershipOfLV() public onlyOwner {
        //test that eth is released and that it works for eth == 0
        withdrawLP();
        Ownable(LV).transferOwnership(owner());
        msg.sender.call{ value: address(this).balance }("");
    }

    function returnOwnershipOfLvWithoutWithdraw() public onlyOwner {
        Ownable(LV).transferOwnership(owner());
    }

    function emergencyWithdrawETH(uint256 weiAmount) public onlyOwner {
        msg.sender.transfer(weiAmount);
    }

    bool alreadyPurchased = false;

    //step 1
    function adminPurchaseLP() public allAboveBoard {
        require(
            !alreadyPurchased,
            "FLASHRESCUE: you've already purchased. Stop it."
        );
        LV.purchaseLP{ value: address(this).balance }();
        alreadyPurchased = true;
    }

    //step 2
    function claimLP(uint256 iterations) public allAboveBoard {
        for (uint256 i = 0; i < iterations; i++) {
            LV.claimLP();
        }
    }

    function withdrawLP() public onlyOwner {
        IUniswapV2Pair pair = IUniswapV2Pair(LV_config_before.rocket.tokenUniswapPair());
        uint256 balance = pair.balanceOf(address(this));
        if (balance > 0) pair.transfer(owner(), balance);
    }

    //step 3
    function withdrawLPTo(address to) public onlyOwner {
        IUniswapV2Pair pair = IUniswapV2Pair(LV_config_before.rocket.tokenUniswapPair());
        uint256 balance = pair.balanceOf(address(this));
        if (balance > 0) pair.transfer(to, balance);
    }

    function withdrawLPAmount(uint256 amount) public onlyOwner {
        IUniswapV2Pair pair = IUniswapV2Pair(LV_config_before.rocket.tokenUniswapPair());
        pair.transfer(owner(), amount);
    }

    function claimableAmountInLP() public view returns (uint256) {
        IUniswapV2Pair pair = IUniswapV2Pair(LV_config_before.rocket.tokenUniswapPair());
        return pair.balanceOf(address(LV));
    }

    function flashRescueCanStillClaim() public view returns (bool) {
        uint256 amountLeftInLV = claimableAmountInLP();
        (, uint256 flashAmount, ) = LV.getLockedLP(address(this), 0);
        return flashAmount <= amountLeftInLV; //only possible because of bug
    }

    function DoInSequence(uint256 iterationsOnClaim) public onlyOwner {
        if (currentStep == Step.Unpurchased) {
            adminPurchaseLP();
            currentStep = Step.Purchased;
            return;
        }

        if (currentStep == Step.Purchased) {
            _enableLV();
            if (flashRescueCanStillClaim()) {
                claimLP(iterationsOnClaim);
            } else {
                currentStep = Step.FinishedClaiming;
            }
            _disableLV();
        }

        if (currentStep == Step.FinishedClaiming) {
            withdrawLP();
            currentStep = Step.Withdrawn;
        }
    }

    function _disableLV() internal {
        LV.setOracleAddress(address(badOracle));
    }

    function _enableLV() internal {
        LV.setOracleAddress(address(LV_config_before.uniswapOracle));
    }
}
