# rock3t-core-contracts
ROCK3T (R3T) is an ERC20 token with changeable FOT with total fixed supply of 11,000,000.

## Overview
The main contracts are LiquidVault for sending ETH and pooling it with R3T to create LP tokens, FeeApprover that calculates FOT, FeeDistributor that distributes fees on LiquidVault. 
**LiquidVault** allows users to send ETH and pool it with R3T, while certain percentage of fee that is calculated using buy pressure formula is swapped on Uniswap market. Minted LP tokens are locked in LiquidVault for a period that is calculated based on the system health.

## Tests and setup
### Prerequisites 
- [node v10.16.0](https://www.npmjs.com/package/node/v/10.16.0)
- [ganache-cli](https://github.com/trufflesuite/ganache-cli) [v6.12.1](https://github.com/trufflesuite/ganache-cli/releases/tag/v6.12.1)
- [solidity](https://github.com/ethereum/solidity) [v0.7.1](https://github.com/ethereum/solidity/releases/tag/v0.7.1)

### Running the tests
1. Run a Ganache environment with predefined ETH amount for test suite:
```
npm run ganache
```
2. Run the tests:
```
npm run test
```
