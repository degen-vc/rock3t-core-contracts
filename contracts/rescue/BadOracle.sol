// SPDX-License-Identifier: MIT

pragma solidity ^0.7.1;
import "@openzeppelin/contracts/GSN/Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../facades/FeeApproverLike.sol";
import "@nomiclabs/buidler/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "../facades/LiquidVaultLike.sol";

contract BadOracle {
}