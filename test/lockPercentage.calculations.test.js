const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const SlidingWindowOracle = artifacts.require('SlidingWindowOracle');
const FeeApprover = artifacts.require('FeeApprover');

contract('liquid vault', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const NOT_OWNER = accounts[1];
  const baseUnit = bn('1000000000000000000');

  const ethFee = 0;
  const blackHoleFee = 10;
  const lvEthFeePercent = 10;
  const feeReceiver = accounts[8];
  const treasury = accounts[7];
  const startTime = Math.floor(Date.now() / 1000);

  const defaultWindowSize = 86400 // 24 hours
  const defaultGranularity = 24 // 1 hour each

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
    uniswapOracle = await SlidingWindowOracle.new(uniswapFactory.address, defaultWindowSize, defaultGranularity);

    await feeApprover.initialize(rocketToken.address, uniswapFactory.address, uniswapRouter.address);
    await feeApprover.unPause();
    await feeApprover.setFeeMultiplier(0);

    await feeDistributor.seed(rocketToken.address, liquidVault.address, OWNER, 0);
    uniswapPair = await rocketToken.tokenUniswapPair();

    await liquidVault.seed(
      rocketToken.address,
      feeDistributor.address,
      blackHoleFee,
      uniswapRouter.address,
      uniswapPair,
      treasury,
      uniswapOracle.address
    );

    const liquidityTokensAmount = bn('678000').mul(baseUnit);
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
      
      await uniswapOracle.update(weth.address, rocketToken.address)

      const blockTimestamp = Number(previousBlockTimestamp) + 23 * 3600
      await ganache.setTime(blockTimestamp.toString());

      await uniswapOracle.update(weth.address, rocketToken.address);
    });

    it('calculates lock percentage', async () => { 
      const result = await liquidVault.lockPercentageUINT();
      assertBNequal(result, '4');
    });
  });
});