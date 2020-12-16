// SPDX-License-Identifier: MIT
pragma solidity ^0.7.1;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FeeDistributor is Ownable {
    IERC20 public R3Ttoken;
    address liquidVault;

    bool public initialized;

    modifier seeded {
        require(
            initialized,
            "R3T: Fees cannot be distributed until Distributor seeded."
        );
        _;
    }

    function seed(address r3t, address vault) public onlyOwner {
        R3Ttoken = IERC20(r3t);
        liquidVault = liquidVault;

        initialized = true;
    }

    function distributeFees() public seeded {
        uint fees = R3Ttoken.balanceOf(address(this));
        R3Ttoken.transfer(liquidVault,fees);
    }
}