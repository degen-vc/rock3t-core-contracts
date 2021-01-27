const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const FeeApprover = artifacts.require('FeeApprover');
const PriceOracle = artifacts.require('PriceOracle');

contract('liquid vault', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const baseUnit = bn('1000000000000000000');

  const treasury = accounts[7];

  let uniswapPair;
  let uniswapFactory;
  let uniswapRouter;
  let weth;

  let feeDistributor;
  let feeApprover;
  let rocketToken;
  let liquidVault;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    // deploy and setup main contracts
    feeApprover = await FeeApprover.new();
    feeDistributor = await FeeDistributor.new();
    rocketToken = await RocketToken.new(feeDistributor.address, feeApprover.address, uniswapRouter.address, uniswapFactory.address);
    liquidVault = await LiquidVault.new();

    await rocketToken.createUniswapPair();
    uniswapPair = await rocketToken.tokenUniswapPair();
    uniswapOracle = await PriceOracle.new(uniswapPair, rocketToken.address, weth.address);

    await feeApprover.initialize(uniswapPair, liquidVault.address);
    await feeApprover.unPause();
    await feeApprover.setFeeMultiplier(0);

    await feeDistributor.seed(rocketToken.address, liquidVault.address, OWNER, 0);

    await liquidVault.seed(
      rocketToken.address,
      feeDistributor.address,
      uniswapRouter.address,
      uniswapPair,
      treasury,
      uniswapOracle.address
    );

    const liquidityTokensAmount = bn('578000').mul(baseUnit);
    const liquidityEtherAmount = bn('1000').mul(baseUnit);

    await rocketToken.approve(uniswapRouter.address, liquidityTokensAmount);
    await uniswapRouter.addLiquidityETH(
      rocketToken.address,
      liquidityTokensAmount,
      0,
      0,
      OWNER,
      new Date().getTime() + 3000,
      {value: liquidityEtherAmount}
    );

    await ganache.snapshot();
  });

  describe('lock percentage calculations', async () => {
    beforeEach('adds prices', async () => {
      const pair = await IUniswapV2Pair.at(uniswapPair);
      const previousBlockTimestamp = (await pair.getReserves())[2]
      
      await uniswapOracle.update();

      const blockTimestamp = Number(previousBlockTimestamp) + 23 * 3600
      await ganache.setTime(blockTimestamp.toString());

      await uniswapOracle.update();
    });

    it('calculates lock percentage', async () => { 
      const result = await liquidVault.lockPercentageUINT();
      assertBNequal(result, '40');
    });
  });
});