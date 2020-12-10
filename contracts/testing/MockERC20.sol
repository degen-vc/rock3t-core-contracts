pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory _name, string memory _symbol, uint256 _totalSupply) public
        ERC20(_name, _symbol)
    {
        _mint(msg.sender, _totalSupply);
    }

    function burn(uint256 value) public {
        _burn(msg.sender, value);
    }
}