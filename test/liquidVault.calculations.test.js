const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectRevert } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const FeeApprover = artifacts.require('FeeApprover');


contract('liquid vault', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const NOT_OWNER = accounts[1];
  const baseUnit = bn('1000000000000000000');
  const treasury = accounts[7];

  let uniswapPair;
  let uniswapFactory;
  let uniswapRouter;

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
      NOT_OWNER
    );

    await ganache.snapshot();
  });

  describe('lock period calculations', async () => {

    it('should revert if reserves are zero', async () => {
      await expectRevert(
        liquidVault.getLockedPeriod(),
        'Reserves cannot be zero.'
      )
    });

    it('should return 3413458 seconds (39.5 days) with 10 ETH and 1000 R3T in reserves', async () => {
      const liquidityTokensAmount = bn('1000').mul(baseUnit); // 1.000 tokens
      const liquidityEtherAmount = bn('10').mul(baseUnit); // 10 ETH

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();
      
      assertBNequal(res, '3413458');
    });

    it('should return 222018 seconds (2.5 days) with 500 ETH and 100k R3T in reserves', async () => {
      const liquidityTokensAmount = bn('100000').mul(baseUnit); // 100.000 tokens
      const liquidityEtherAmount = bn('500').mul(baseUnit); // 500 ETH

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();

      assertBNequal(res, '222018');
    });

    it('should return 2998153 seconds (34.7 days) with 100 ETH and 50k R3T', async () => {
      const liquidityTokensAmount = bn('50000').mul(baseUnit); // 50.000 tokens
      const liquidityEtherAmount = bn('100').mul(baseUnit); // 100 ETH

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();

      assertBNequal(res, '2998153');
    });

    it('should return 86400 seconds (1 day) with 10000 ETH and 300k R3T', async () => {
      const liquidityTokensAmount = bn('300000').mul(baseUnit); // 300.000 tokens
      const liquidityEtherAmount = bn('10000').mul(baseUnit); // 1.0000 ETH

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();

      assertBNequal(res, '86400');
    });

    it('should return 3888000 seconds (45 days) with 1 WEI and 100000 R3T', async () => {
      const liquidityTokensAmount = bn('10000').mul(baseUnit); // 100.000 tokens
      const liquidityEtherAmount = 1; // 1 WEI

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();

      assertBNequal(res, '3888000');
    });

    it('should return 3887999 seconds (44.9 days) with 1 WEI and 0.0011 R3T', async () => {
      const liquidityTokensAmount = 1100000; // 0.0011 tokens
      const liquidityEtherAmount = 1; // 1 WEI

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();

      assertBNequal(res, '3887999');
    });

    it('should return 86400 seconds (1 days) with 1000 ETH and 0.0011 R3T', async () => {
      const liquidityTokensAmount = 1100000; // 0.0011 tokens
      const liquidityEtherAmount = bn('10000').mul(baseUnit); // 1.0000 ETH

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();

      assertBNequal(res, '86400');
    });

    it('should return 3888000 seconds (45 days) with 1 WEI and 300000 R3T', async () => {
      const liquidityTokensAmount = bn('300000').mul(baseUnit); // 300.000 tokens
      const liquidityEtherAmount = 1; // 1 WEI

      const pair = await IUniswapV2Pair.at(uniswapPair);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);

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

      const res = await liquidVault.getLockedPeriod();

      assertBNequal(res, '3888000');
    });
  });

  describe('force unlock LP', async () => {
    it('should be possible to force unlock LP for an owner', async () => {
      assert.isFalse(await liquidVault.forceUnlock());
      await liquidVault.enableLPForceUnlock();
      assert.isTrue(await liquidVault.forceUnlock());
    });

    it('should NOT be possible to force unlock LP for NOT an owner', async () => {
      assert.isFalse(await liquidVault.forceUnlock());

      await expectRevert(
        liquidVault.enableLPForceUnlock({from: NOT_OWNER}),
        'Ownable: caller is not the owner'
      )
      assert.isFalse(await liquidVault.forceUnlock());
    });

    it('should return 0 time locked period if force unlocked', async () => {
      const liquidityTokensAmount = 1100000; // 0.0011 tokens
      const liquidityEtherAmount = bn('10000').mul(baseUnit); // 1.0000 ETH

      const pair = await IUniswapV2Pair.at(uniswapPair);

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

      assertBNequal(await liquidVault.getLockedPeriod(), '86400');

      await liquidVault.enableLPForceUnlock();
      assert.isTrue(await liquidVault.forceUnlock());

      assertBNequal(await liquidVault.getLockedPeriod(), '0');


    });
  });

});