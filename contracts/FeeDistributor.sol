// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./facades/ERC20Like.sol";

contract FeeDistributor is Ownable {
    using SafeMath for uint;

    ERC20Like public token;

    struct FeeRecipient {
        address liquidVault;
        address dev;
        uint256 liquidVaultShare; //percentage between 0 and 100
        uint256 burnPercentage;
    }

    FeeRecipient public recipients;

    bool public initialized;

    modifier seeded {
        require(
            initialized,
            "FeeDistributor: Fees cannot be distributed until Distributor seeded."
        );
        _;
    }

    function seed(
        address tokenAddress,
        address liquidVault,
        address dev,
        uint256 liquidVaultShare,
        uint256 burnPercentage
    ) public onlyOwner {
        require(
            liquidVaultShare.add(burnPercentage) <= 100,
            "FeeDistributor: liquidVault + burnPercentage incorrect sets"
        );

        token = ERC20Like(tokenAddress);
        recipients.liquidVault = liquidVault;
        recipients.dev = dev;
        recipients.liquidVaultShare = liquidVaultShare;
        recipients.burnPercentage = burnPercentage;
        initialized = true;
    }

    function distributeFees() public seeded {
        uint256 balance = token.balanceOf(address(this));

        require(balance > 100, "FeeDistributor: low token balance");

        uint256 liquidShare;
        uint256 burningShare;

        if (recipients.liquidVaultShare > 0) {
            liquidShare = recipients.liquidVaultShare.mul(balance).div(100);

            require(
                token.transfer(recipients.liquidVault, liquidShare),
                "FeeDistributor: transfer to liquidVault failed"
            );
        }

        if (recipients.burnPercentage > 0) {
            burningShare = recipients.burnPercentage.mul(balance).div(100);
            token.burn(burningShare);
        }

        require(
            token.transfer(recipients.dev, balance.sub(liquidShare).sub(burningShare)),
            "FeeDistributor: transfer to dev failed"
        );
    }
}