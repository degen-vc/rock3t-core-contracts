const UniswapFactory = artifacts.require('UniswapFactory');
const UniswapWETH = artifacts.require('UniswapWETH');
const UniswapRouter = artifacts.require('UniswapRouter');

async function deployUniswap(accounts) {
  const feeSetter = accounts[0];
  const uniswapFactory = await UniswapFactory.new(feeSetter);
  const weth = await UniswapWETH.new();
  const uniswapRouter = await UniswapRouter.new(uniswapFactory.address, weth.address);

  return { uniswapFactory, weth, uniswapRouter };
}

module.exports = deployUniswap;