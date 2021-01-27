
const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const FeeApprover = artifacts.require('FeeApprover');
const PriceOracle = artifacts.require('PriceOracle');


contract('liquid vault buy pressure', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const NOT_OWNER = accounts[1];
  const baseUnit = bn('1000000000000000000');

  const treasury = accounts[7];

  let uniswapOracle;
  let uniswapPair;
  let uniswapFactory;
  let uniswapRouter;
  let weth;

  let feeDistributor;
  let rocketToken;
  let liquidVault;
  let feeApprover

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

    await feeDistributor.seed(rocketToken.address, liquidVault.address, OWNER, 0);

    await liquidVault.seed(
      rocketToken.address,
      feeDistributor.address,
      uniswapRouter.address,
      uniswapPair,
      treasury,
      uniswapOracle.address
    );

    await ganache.snapshot();
  });

  it('should set default calibrations values after deploy', async () => {
    const calibration = await liquidVault.calibration();

    assert.equal(calibration.a, '0xbfcb59e05f1e2674d208f2461d9cb64e');
    assert.equal(calibration.b, '0x3fde33dcfe54a3802b3e313af8e0e525');
    assert.equal(calibration.c, '0x3ff164840e1719f7f8ca8198f1d3ed52');
    assert.equal(calibration.d, '0x00000000000000000000000000000000');
    assertBNequal(calibration.maxReserves, '500000000000000000000000');
  });

  it('should be possible to calibrate buy pressure formula for owner', async () => {
    await liquidVault.calibrate(
      '0x52000000000000000000000000000000',
      '0x25000000000000000000000000000000',
      '0x8e000000000000000000000000000000',
      '0xaf000000000000000000000000000000',
      100
    );

    const calibration = await liquidVault.calibration();
    assert.equal(calibration.a, '0x52000000000000000000000000000000');
    assert.equal(calibration.b, '0x25000000000000000000000000000000');
    assert.equal(calibration.c, '0x8e000000000000000000000000000000');
    assert.equal(calibration.d, '0xaf000000000000000000000000000000');
    assertBNequal(calibration.maxReserves, 100);
  });

  it('should NOT be possible to calibrate buy pressure formula for NOT owner', async () => {
    await expectRevert(
      liquidVault.calibrate(
        '0x52000000000000000000000000000000',
        '0x25000000000000000000000000000000',
        '0x8e000000000000000000000000000000',
        '0xaf000000000000000000000000000000',
        100,
        {from: NOT_OWNER}
      ),
      'Ownable: caller is not the owner'
    )

    const calibration = await liquidVault.calibration();
    assert.equal(calibration.a, '0xbfcb59e05f1e2674d208f2461d9cb64e');
    assert.equal(calibration.b, '0x3fde33dcfe54a3802b3e313af8e0e525');
    assert.equal(calibration.c, '0x3ff164840e1719f7f8ca8198f1d3ed52');
    assert.equal(calibration.d, '0x00000000000000000000000000000000');
    assertBNequal(calibration.maxReserves, '500000000000000000000000');
  });

  it('should be possible to get current buy pressure fee amount as 0%', async () => {
    const liquidityTokensAmount = bn('1000').mul(baseUnit); // 1.000 tokens
    const liquidityEtherAmount = bn('10').mul(baseUnit); // 10 ETH

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

    const fee = await liquidVault.feeUINT();
    assertBNequal(fee, 0);
  });

  it('should be possible to get current buy pressure fee amount as 20%', async () => {
    const liquidityTokensAmount = bn('199000').mul(baseUnit); // 199.000 tokens
    const liquidityEtherAmount = bn('10').mul(baseUnit); // 10 ETH

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

    const fee = await liquidVault.feeUINT();
    assertBNequal(fee, 200);
  });

  it('should be possible to get current buy pressure fee amount as max 40%', async () => {
    const liquidityTokensAmount = bn('500000').mul(baseUnit); // 600.000 tokens
    const liquidityEtherAmount = bn('10').mul(baseUnit); // 10 ETH

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

    const fee = await liquidVault.feeUINT();
    assertBNequal(fee, 400);
  });

  it('should be possible to get current buy pressure fee amount as max 40% if there are 9mln tokens in pair', async () => {
    const liquidityTokensAmount = bn('9000000').mul(baseUnit); // 9.000.000 tokens
    const liquidityEtherAmount = bn('10').mul(baseUnit); // 10 ETH

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

    const fee = await liquidVault.feeUINT();
    assertBNequal(fee, 400);
  });

  it('should be possible to purchaseLP with eth fee 20% and fee swapped on uniswap', async () => {
    const liquidityTokensAmount = bn('199000').mul(baseUnit); // 199.000 tokens
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

    const amount = bn('890000').mul(baseUnit);
    await rocketToken.transfer(liquidVault.address, amount);

    const balanceBefore = await rocketToken.balanceOf(liquidVault.address);

    const result = await liquidVault.purchaseLP({ value: '10000' });
    const expectedLockPeriod = await liquidVault.getLockedPeriod();

    expectEvent(result, 'LPQueued', {
      lockPeriod: expectedLockPeriod.toString()
    });

    assert.equal(result.logs.length, 1);
    const rocketRequired = result.logs[0].args.r3t;

    const ethFee = bn(10000).mul(bn(20)).div(bn(100));

    assertBNequal(result.logs[0].args.eth, bn('10000').sub(ethFee));

    const balanceAfter = await rocketToken.balanceOf(liquidVault.address);
    // eth fee is 20
    assert.equal(balanceBefore.lt(balanceAfter.add(rocketRequired)), true);
  });

  it('should be possible to purchaseLP with max 40% eth fee and fee swapped on uniswap', async () => {
    const liquidityTokensAmount = bn('600000').mul(baseUnit); // 600.000 tokens
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

    const amount = bn('890000').mul(baseUnit);
    await rocketToken.transfer(liquidVault.address, amount);

    const balanceBefore = await rocketToken.balanceOf(liquidVault.address);

    const result = await liquidVault.purchaseLP({ value: '10000' });
    const expectedLockPeriod = await liquidVault.getLockedPeriod();

    expectEvent(result, 'LPQueued', {
      lockPeriod: expectedLockPeriod.toString()
    });

    assert.equal(result.logs.length, 1);
    const rocketRequired = result.logs[0].args.r3t;

    const ethFee = bn(10000).mul(bn(40)).div(bn(100));

    assertBNequal(result.logs[0].args.eth, bn('10000').sub(ethFee));

    const balanceAfter = await rocketToken.balanceOf(liquidVault.address);
    // eth fee is 40
    assert.equal(balanceBefore.lt(balanceAfter.add(rocketRequired)), true);
  });

  it('should be possible to purchaseLP with zero eth fee that not swapped on uniswap', async () => {
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

    const amount = bn('890000').mul(baseUnit);
    await rocketToken.transfer(liquidVault.address, amount);

    const balanceBefore = await rocketToken.balanceOf(liquidVault.address);

    const result = await liquidVault.purchaseLP({ value: '10000' });
    const expectedLockPeriod = await liquidVault.getLockedPeriod();

    expectEvent(result, 'LPQueued', {
      lockPeriod: expectedLockPeriod.toString()
    });

    assert.equal(result.logs.length, 1);
    const rocketRequired = result.logs[0].args.r3t;

    const balanceAfter = await rocketToken.balanceOf(liquidVault.address);
    // eth fee is 0, so liquidVault did not receive tokens from fee swap
    assert.equal(balanceAfter.add(rocketRequired).eq(balanceBefore), true);
  });

});
