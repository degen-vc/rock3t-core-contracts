pragma solidity ^0.6.12;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract WETH is ERC20 {
    constructor(string memory name, string memory symbol)
        public
        ERC20(name, symbol)
    {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 value) external {
        _burn(msg.sender, value);
        address payable sender = msg.sender;
        (bool success, ) = sender.call.value(value)("");
        require(success, "Unwrapping failed.");
    }
}
