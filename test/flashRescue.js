
const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const FeeApprover = artifacts.require('FeeApprover');
const PriceOracle = artifacts.require('PriceOracle');
const BadOracle = artifacts.require('BadOracle');
const FlashRescue = artifacts.require('FlashRescue');


contract('flash rescue', function(accounts) {
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

  let badOracle;
  let flashRescue;

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

    badOracle = await BadOracle.new();
    flashRescue = await FlashRescue.new();

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


    it('should be possible to lock liquid vault contract and not allow to make new purchases', async () => {
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

      await liquidVault.setOracleAddress(badOracle.address);

      await expectRevert.unspecified(
        liquidVault.purchaseLP({ value: '10000' })
      );

    });

    it('should be possible to lock liquid vault contract and not allow to claim LP', async () => {
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

      await liquidVault.claimLP();

      await liquidVault.setOracleAddress(badOracle.address);

      await expectRevert.unspecified(
        liquidVault.claimLP()
      );

    });

    it('should be possible to make purchase lp from flash rescue on locked liquid vault', async () => {
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

      await liquidVault.transferOwnership(flashRescue.address);

      await flashRescue.seed(liquidVault.address, { value: '10000' });
      await flashRescue.captureConfig(rocketToken.address, uniswapOracle.address);

      await expectRevert.unspecified(
        liquidVault.claimLP()
      );

    });

    it('MAIN. should be possible to make purchase lp from flash rescue on locked liquid vault, get locked LPs', async () => {
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

      // 1. liquidVault.flushToTreasury()
      // DO it on prod manually 

      // 2. liquidVault.enableLPForceUnlock()
      await liquidVault.enableLPForceUnlock();

      // 3. liquidVault.calibrateLockPercentage() - set dMax to zero
      await liquidVault.calibrateLockPercentage(
        '0x00000000000000000000000000000000',
        '0x3ff7cac083126e978d4fdf3b645a1cac',
        '0x40004000000000000000000000000000',
        '0x40061db6db6db5a1484ad8a787aa1421'
      )

      // 4. liquidVault.transferOwnership(flashRescue.address);
      await liquidVault.transferOwnership(flashRescue.address);

      // 5. flashRescue.seed(liquidVault.address, { value: '10000' }); - send eth
      await flashRescue.seed(liquidVault.address, { value: '10000' });

      // 6. await flashRescue.captureConfig(rocketToken.address, uniswapOracle.address);
      await flashRescue.captureConfig(rocketToken.address, uniswapOracle.address);

      await expectRevert.unspecified(
        liquidVault.purchaseLP({ value: '10000' })
      );

      // 7. flashRescue.adminPurchaseLP();
      assertBNequal(await liquidVault.lockedLPLength(flashRescue.address), 0);
      await flashRescue.adminPurchaseLP();
      assertBNequal(await liquidVault.lockedLPLength(flashRescue.address), 1);

      // 8. flashRescue.claimLP(4); - iterations
      assertBNequal(await pair.balanceOf(liquidVault.address), 400000);
      assertBNequal(await pair.balanceOf(flashRescue.address), 0);

      await ganache.setTime(startTime + 10);
      await flashRescue.claimLP(4); 
      assertBNequal(await pair.balanceOf(liquidVault.address), 0);
      assertBNequal(await pair.balanceOf(flashRescue.address), 400000);

      //  9. flashRescue.withdrawLPTo(OWNER)
      assertBNequal(await pair.balanceOf(flashRescue.address), 400000);
      assertBNequal(await pair.balanceOf(treasury), 0);

      await flashRescue.withdrawLPTo(treasury);
      assertBNequal(await pair.balanceOf(flashRescue.address), 0);
      assertBNequal(await pair.balanceOf(treasury), 400000);

      // 10. flashRescue. returnOwnershipOfLvWithoutWithdraw()
      assert.equal(await liquidVault.owner(), flashRescue.address);
      await flashRescue.returnOwnershipOfLvWithoutWithdraw();
      assert.equal(await liquidVault.owner(), OWNER);
    });
  });
