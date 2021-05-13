
const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

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
  const NOT_OWNER = accounts[1];
  const baseUnit = bn('1000000000000000000');
  const startTime = Math.floor(Date.now() / 1000);

  const treasury = accounts[7];

  let uniswapOracle;
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

    await ganache.snapshot();
  });

  describe('General tests', async () => {
    it('should set all values after LV setup', async () => {
      const config = await liquidVault.config();

      assert.equal(config.R3T, rocketToken.address);
      assert.equal(config.feeDistributor, feeDistributor.address);
      assert.equal(config.tokenPair, uniswapPair);
      assert.equal(config.uniswapRouter, uniswapRouter.address);
      assert.equal(config.weth, weth.address);
      assert.equal(treasury, treasury);
      assert.equal(config.uniswapOracle, uniswapOracle.address);
    });

    it('should be possible to flush to treasury from owner', async () => {
      const amount = 10000;
      await rocketToken.transfer(liquidVault.address, amount);

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), amount);
      assertBNequal(await rocketToken.balanceOf(treasury), 0);

      await liquidVault.flushToTreasury(amount);

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), 0);
      assertBNequal(await rocketToken.balanceOf(treasury), amount);
    });

    it('should NOT possible to flush to treasury from NOT owner', async () => {
      const amount = 10000;
      await rocketToken.transfer(liquidVault.address, amount);

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), amount);
      assertBNequal(await rocketToken.balanceOf(treasury), 0);

      await expectRevert(
        liquidVault.flushToTreasury(amount, {from: NOT_OWNER}),
        'Ownable: caller is not the owner',
      );

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), amount);
      assertBNequal(await rocketToken.balanceOf(treasury), 0);
    });

    it('should be possible to add liquidity on pair', async () => {
      const liquidityTokensAmount = bn('10000').mul(baseUnit); // 10.000 tokens
      const liquidityEtherAmount = bn('5').mul(baseUnit); // 5 ETH

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

      const reservesAfter = await pair.getReserves();

      if (await pair.token0() == rocketToken.address) {
        assertBNequal(reservesAfter[0], liquidityTokensAmount);
        assertBNequal(reservesAfter[1], liquidityEtherAmount);
      } else {
        assertBNequal(reservesAfter[0], liquidityEtherAmount);
        assertBNequal(reservesAfter[1], liquidityTokensAmount);
      }
    });

    it('should be possible to swapExactETHForTokens directly', async () => {
      const liquidityTokensAmount = bn('10000').mul(baseUnit); // 10.000 tokens
      const liquidityEtherAmount = bn('5').mul(baseUnit); // 5 ETH

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

      assertBNequal(await rocketToken.balanceOf(uniswapPair), '10000000000000000000000');

      await uniswapRouter.swapExactETHForTokens(0, [weth.address, rocketToken.address], liquidVault.address, 7258118400, {value: 100})

      assertBNequal(await rocketToken.balanceOf(uniswapPair), '9999999999999999800601');
    });


    it('should be possible to purchaseLP', async () => {
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

  describe('Claim LP', async () => {
    it('should not be possible to claim zero LP', async () => {
      const liquidityTokensAmount = bn('10000').mul(baseUnit); // 10.000 tokens
      const liquidityEtherAmount = bn('5').mul(baseUnit); // 5 ETH

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
      
      await expectRevert(
        liquidVault.claimLP(),
        'R3T: nothing to claim.'
      );
    });

    it('should not be possible to claim LP while it is still locked', async () => {
      const liquidityTokensAmount = bn('10000').mul(baseUnit); // 10.000 tokens
      const liquidityEtherAmount = bn('5').mul(baseUnit); // 5 ETH

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

      const result = await liquidVault.purchaseLP({ value: '10000' });

      assert.equal(result.logs.length, 1);
      
      await expectRevert(
        liquidVault.claimLP(),
        'R3T: LP still locked.'
      );
    });

    it('should be possible to claim LP after the purchase', async () => {
      const liquidityTokensAmount = bn('1000').mul(baseUnit); // 10.000 tokens
      const liquidityEtherAmount = bn('10').mul(baseUnit); // 5 ETH

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

      const lockTime = await liquidVault.getLockedPeriod.call();
      
      await ganache.setTime(startTime);
      const result = await liquidVault.purchaseLP({ value: '10000' });
      assert.equal(result.logs.length, 1);

      const lockedLPLength = await liquidVault.lockedLPLength(OWNER);
      assertBNequal(lockedLPLength, 1);

      const resultSecondPurchase = await liquidVault.purchaseLP({ value: '20000' });
      assert.equal(resultSecondPurchase.logs.length, 1);

      const lockedLPLengthSecondPurchase = await liquidVault.lockedLPLength(OWNER);
      assertBNequal(lockedLPLengthSecondPurchase, 2);

      await uniswapOracle.update();

      const lpBalanceBefore = await pair.balanceOf(OWNER);
      const claimTime = bn(startTime).add(bn(lockTime)).add(bn(1)).toString();
      await ganache.setTime(claimTime);
      await uniswapOracle.update();
      const oracleUpdateTimestamp = Number(claimTime) + 7 * 1800;
      await ganache.setTime(oracleUpdateTimestamp);

      const lockedLP = await liquidVault.getLockedLP(OWNER, 0);
      const claim = await liquidVault.claimLP();

      const lpBalanceAfter = await pair.balanceOf(OWNER);
      const lockedLPLengthAfterClaim = await liquidVault.lockedLPLength(OWNER);

      const holder = lockedLP[0];
      const amountToClaim = lockedLP[1];
      const expectedLockPercentage = 20;
      const lockPercentage = await liquidVault.lockPercentageUINT();
      const expectedFee = Math.floor((amountToClaim * expectedLockPercentage) / 1000);
      const expectedBalance = amountToClaim - expectedFee;
      const actualFee = claim.logs[0].args[3];

      assert.equal(holder, OWNER);
      assertBNequal(expectedLockPercentage.toString(), lockPercentage);
      assertBNequal(lockedLPLengthAfterClaim, lockedLPLengthSecondPurchase);
      assertBNequal(amountToClaim, claim.logs[0].args[1]);
      assertBNequal(expectedFee, actualFee);
      assertBNequal(expectedBalance, bn(lpBalanceAfter).sub(bn(lpBalanceBefore)));
    });

    it('should not be possible to claim LP after all is claimed', async () => {
      const liquidityTokensAmount = bn('1000').mul(baseUnit); // 10.000 tokens
      const liquidityEtherAmount = bn('10').mul(baseUnit); // 5 ETH

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

      const lockTime = await liquidVault.getLockedPeriod.call();
      
      await ganache.setTime(startTime);
      const result = await liquidVault.purchaseLP({ value: '10000' });
      assert.equal(result.logs.length, 1);

      const lockedLPLength = await liquidVault.lockedLPLength(OWNER);
      assertBNequal(lockedLPLength, 1);

      const resultSecondPurchase = await liquidVault.purchaseLP({ value: '20000' });
      assert.equal(resultSecondPurchase.logs.length, 1);

      await liquidVault.purchaseLP({ value: '20000', from: NOT_OWNER });

      const lockedLPLengthSecondPurchase = await liquidVault.lockedLPLength(OWNER);
      assertBNequal(lockedLPLengthSecondPurchase, 2);

      await uniswapOracle.update();

      const claimTime = bn(startTime).add(bn(lockTime)).add(bn(1)).toString();
      await ganache.setTime(claimTime);
      await uniswapOracle.update();
      const oracleUpdateTimestamp = Number(claimTime) + 7 * 1800;
      await ganache.setTime(oracleUpdateTimestamp);

      // successfully claim 2 batches
      await liquidVault.claimLP();
      await liquidVault.claimLP();

      // impossible to claim other's batch
      await expectRevert(liquidVault.claimLP(), 'R3T: nothing to claim.');
    });
  });
});
