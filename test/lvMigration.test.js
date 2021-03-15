const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const FeeApprover = artifacts.require('FeeApprover');
const PriceOracle = artifacts.require('PriceOracle');


contract('liquid vault v2 migration', accounts => {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const NOT_OWNER = accounts[1];
  const LP_HOLDER = accounts[2];
  const LP_HOLDER2 = accounts[3];
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

    await ganache.snapshot();
  });

  it('should fail manual batch insertion for non-owner', async () => {
    const lpAmount = bn('10').mul(baseUnit)
    await expectRevert(
      liquidVault.insertUnclaimedBatchFor([LP_HOLDER], [lpAmount], [startTime], {from: NOT_OWNER}),
      'Ownable: caller is not the owner'
    )
  })

  it('increases holder\'s locked lp length by 1 with manual batch insertion', async () => {
    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)
    const lpAmount = bn('20').mul(baseUnit)
    const holdersLpAmount = bn('5').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    const liquidVaultsBalance = await lpTokenInstance.balanceOf(liquidVault.address)
    assertBNequal(liquidVaultsBalance, lpAmount)
    assert.isFalse(await liquidVault.batchInsertionFinished())

    //insert a batch to assign LP amount for a holder
    await liquidVault.insertUnclaimedBatchFor([LP_HOLDER], [holdersLpAmount], [startTime])

    const lpLength = await liquidVault.lockedLPLength(LP_HOLDER)
    assertBNequal(lpLength, 1)
    
    const { holder, amount, timestamp, claimed } = await liquidVault.lockedLP(LP_HOLDER, 0)
    assertBNequal(amount, holdersLpAmount)
    assertBNequal(startTime, timestamp)
    assert.equal(holder, LP_HOLDER)
    assert.equal(claimed, false)
  })

  it('manual batch insertion performed along with the regular purchaseLP', async () => {
    const holdersLpAmount = bn('4').mul(baseUnit)
    const holdersLpAmountSecond = bn('10000000000000000000')

    const lpLengthBefore = await liquidVault.lockedLPLength(LP_HOLDER2)
    assertBNequal(lpLengthBefore, 0)
    
    await liquidVault.insertUnclaimedBatchFor([LP_HOLDER2], [holdersLpAmount], [startTime])
    const lpLengthAfter = await liquidVault.lockedLPLength(LP_HOLDER2)
    assertBNequal(lpLengthAfter, 1)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')
    const purchase = await liquidVault.purchaseLP({ value: bn('1').mul(baseUnit), from: LP_HOLDER2 })
    const lpLengthAfter2 = await liquidVault.lockedLPLength(LP_HOLDER2)
    assertBNequal(lpLengthAfter2, 2)

    const { holder, amount, timestamp, claimed } = await liquidVault.lockedLP(LP_HOLDER2, 1)
    assertBNequal(amount, holdersLpAmountSecond)
    assertBNequal(purchase.receipt.logs[0].args[4], timestamp)
    assert.equal(holder, LP_HOLDER2)
    assert.equal(claimed, false)
  })

  it('all batches are claimed by lpHolder2 in the correct order', async () => {
    const holdersLpAmount = bn('4').mul(baseUnit)
    const holdersLpAmountSecond = bn('10000000000000000000')

    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)

    const lpAmount = bn('20').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    await liquidVault.lockedLPLength(LP_HOLDER2)
    
    await liquidVault.insertUnclaimedBatchFor([LP_HOLDER2], [holdersLpAmount], [startTime])
    await liquidVault.lockedLPLength(LP_HOLDER2)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')
    await liquidVault.purchaseLP({ value: bn('1').mul(baseUnit), from: LP_HOLDER2 })

    const lpLength = await liquidVault.lockedLPLength(LP_HOLDER2)
    assertBNequal(lpLength, 2)

    const { holder: firstBatchHolder, amount: firstBatchAmount, claimed: firstBatchClaimed } = await liquidVault.lockedLP(LP_HOLDER2, 0)
    assertBNequal(firstBatchAmount, holdersLpAmount)
    assert.equal(firstBatchHolder, LP_HOLDER2)
    assert.equal(firstBatchClaimed, false)

    const { holder: secondBatchHolder, amount: secondBatchAmount, claimed: secondBatchClaimed } = await liquidVault.lockedLP(LP_HOLDER2, 1)
    assertBNequal(secondBatchAmount, holdersLpAmountSecond)
    assert.equal(secondBatchHolder, LP_HOLDER2)
    assert.equal(secondBatchClaimed, false)

    const lockPeriod = await liquidVault.getLockedPeriod()
    await ganache.setTime(bn(startTime).add(bn(lockPeriod.toString())))

    const firstClaim = await liquidVault.claimLP({ from: LP_HOLDER2 })
    const lpBalanceAfterFirstClaim = await lpTokenInstance.balanceOf(LP_HOLDER2)
    const exitFeeFirst = firstClaim.receipt.logs[0].args[3]
    const expectedBalanceAfterFirst = holdersLpAmount.sub(exitFeeFirst)

    const { claimed: firstBatchClaimedAfter } = await liquidVault.lockedLP(LP_HOLDER2, 0)
    
    assert.equal(firstBatchClaimedAfter, true)
    assertBNequal(firstBatchAmount, holdersLpAmount)
    assert.equal(firstBatchHolder, LP_HOLDER2)
    assert.equal(firstBatchClaimed, false)

    assert.equal(firstClaim.receipt.logs[0].args[0], LP_HOLDER2)
    assertBNequal(firstClaim.receipt.logs[0].args[1], holdersLpAmount)
    assertBNequal(lpBalanceAfterFirstClaim, expectedBalanceAfterFirst)

    const secondClaim = await liquidVault.claimLP({ from: LP_HOLDER2 })
    const lpBalanceAfterSecondClaim = await lpTokenInstance.balanceOf(LP_HOLDER2)
    const exitFeeSecond = secondClaim.receipt.logs[0].args[3]
    const expectedBalanceAfterSecond = expectedBalanceAfterFirst.add(holdersLpAmountSecond.sub(exitFeeSecond))

    assert.equal(secondClaim.receipt.logs[0].args[0], LP_HOLDER2)
    assertBNequal(secondClaim.receipt.logs[0].args[1], holdersLpAmountSecond)
    assertBNequal(lpBalanceAfterSecondClaim, expectedBalanceAfterSecond)
  })

  it('lpHolder2 claim fails when everything is claimed', async () => {
    const holdersLpAmount = bn('4').mul(baseUnit)

    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)

    const lpAmount = bn('20').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    await liquidVault.lockedLPLength(LP_HOLDER2)

    await liquidVault.insertUnclaimedBatchFor([LP_HOLDER2], [holdersLpAmount], [startTime])
    await liquidVault.lockedLPLength(LP_HOLDER2)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')
    await liquidVault.purchaseLP({ value: bn('1').mul(baseUnit), from: LP_HOLDER2 })


    const lockPeriod = await liquidVault.getLockedPeriod()
    await ganache.setTime(bn(startTime).add(bn(lockPeriod.toString())))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    await liquidVault.claimLP({ from: LP_HOLDER2 })

    const lpLength = await liquidVault.lockedLPLength(LP_HOLDER2)
    assertBNequal(lpLength, 2)

    await expectRevert(
      liquidVault.claimLP({ from: LP_HOLDER2 }),
      'R3T: nothing to claim.'
    )
  })

  it('lpHolder2 purchases another batch after all previous batches are claimed', async () => {
    const holdersLp = bn('4').mul(baseUnit)

    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)

    const lpAmount = bn('20').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    await liquidVault.lockedLPLength(LP_HOLDER2)
    
    await liquidVault.insertUnclaimedBatchFor([LP_HOLDER2], [holdersLp], [startTime])
    await liquidVault.lockedLPLength(LP_HOLDER2)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')
    await liquidVault.purchaseLP({ value: bn('1').mul(baseUnit), from: LP_HOLDER2 })


    const lockPeriod = await liquidVault.getLockedPeriod()
    await ganache.setTime(bn(startTime).add(bn(lockPeriod.toString())))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    await liquidVault.claimLP({ from: LP_HOLDER2 })

    await ganache.setTime(startTime)
    const purchase = await liquidVault.purchaseLP({ value: bn('1').mul(baseUnit), from: LP_HOLDER2 })
    const holdersLpAmount = purchase.receipt.logs[0].args[1]
    const lpLengthAfter = await liquidVault.lockedLPLength(LP_HOLDER2)
    assertBNequal(lpLengthAfter, 3)

    await ganache.setTime(bn(startTime).add(bn(lockPeriod.toString())))
    const { holder, amount, timestamp } = await liquidVault.lockedLP(LP_HOLDER2, 2)
    
    assertBNequal(holdersLpAmount, amount)
    assertBNequal(purchase.receipt.logs[0].args[4], timestamp)
    assert.equal(LP_HOLDER2, holder)

    const lpBalanceBeforeClaim = await lpTokenInstance.balanceOf(LP_HOLDER2)
    const claim = await liquidVault.claimLP({ from: LP_HOLDER2 })
    const lpBalanceAfterClaim = await lpTokenInstance.balanceOf(LP_HOLDER2)
    const exitFee = claim.receipt.logs[0].args[3]
    const expectedBalanceAfter = lpBalanceBeforeClaim.add(holdersLpAmount.sub(exitFee))

    assert.equal(claim.receipt.logs[0].args[0], LP_HOLDER2)
    assertBNequal(claim.receipt.logs[0].args[1], holdersLpAmount)
    assertBNequal(lpBalanceAfterClaim, expectedBalanceAfter)

    await expectRevert(
      liquidVault.claimLP({ from: LP_HOLDER2 }),
      'R3T: nothing to claim.'
    )
  })

  it('manual batch insertion disabling doesn\'t allow to call insertUnclaimedBatchFor() anymore', async () => {
    const holdersLpAmount = bn('5').mul(baseUnit)

    assert.isFalse(await liquidVault.batchInsertionFinished())
    await liquidVault.insertUnclaimedBatchFor([LP_HOLDER], [holdersLpAmount], [startTime])
    await liquidVault.finishBatchInsertion();
    assert.isTrue(await liquidVault.batchInsertionFinished())

    await expectRevert(
      liquidVault.insertUnclaimedBatchFor([LP_HOLDER], [holdersLpAmount], [startTime]),
      'R3T: Manual batch insertion is no longer allowed.'
    )
  })

  it('should be possible to fill locked batches via admin function insertUnclaimedBatchFor', async () => {
    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)

    const lpAmount = bn('90').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')


    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 0)

    const LP_HOLDER3 = accounts[4];
    const LP_HOLDER4 = accounts[5];
    const LP_HOLDER5 = accounts[6];

    const LP_HOLDER_AMOUNT_1 = bn('1').mul(baseUnit).div(bn('10')) // 0.1 LP
    const LP_HOLDER_AMOUNT_2 = bn('5').mul(baseUnit).div(bn('10')) // 0.5 LP
    const LP_HOLDER_AMOUNT_3 = bn('1').mul(baseUnit) // 1 LP
    const LP_HOLDER_AMOUNT_4 = bn('2').mul(baseUnit).div(bn('10')) // 0.2 LP
    const LP_HOLDER_AMOUNT_5 = bn('2').mul(baseUnit) // 2 LP

    const LP_HOLDERS = [
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5
    ]

    const LP_HOLDER_AMOUNTS = [
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5
    ]

    const startTime2 = startTime + 3600
    const startTime3 = startTime + 7200
    const startTime4 = startTime + 9000
    const startTime5 = startTime + 15000

    const LOCK_START_TIME = [
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5
    ]

    const result = await liquidVault.insertUnclaimedBatchFor(LP_HOLDERS, LP_HOLDER_AMOUNTS, LOCK_START_TIME);
    //GAS Price - 200GWEI
    //GAS USED - 3.432.885
    console.log(`gasUsed on 50 insertions via insertUnclaimedBatchFor: ${result.receipt.gasUsed}`)

    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER3), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER4), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER5), 10);
  })

  it('should not be possible to use insertUnclaimedBatchFor if holders and amounts arrays has different length', async () => {
    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)

    const lpAmount = bn('90').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')


    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 0)

    const LP_HOLDER3 = accounts[4];
    const LP_HOLDER_AMOUNT_1 = bn('1').mul(baseUnit).div(bn('10')) // 0.1 LP

    await expectRevert(
      liquidVault.insertUnclaimedBatchFor([LP_HOLDER2, LP_HOLDER3, LP_HOLDER3], [LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_1], [startTime, startTime]),
      'R3T: Batch arrays should have same length'
    )

    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 0);
  })

  it('should not be possible to use insertUnclaimedBatchFor if unlockTime and amounts arrays has different length', async () => {
    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)

    const lpAmount = bn('90').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')


    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 0)

    const LP_HOLDER3 = accounts[4];
    const LP_HOLDER_AMOUNT_1 = bn('1').mul(baseUnit).div(bn('10')) // 0.1 LP

    await expectRevert(
      liquidVault.insertUnclaimedBatchFor([LP_HOLDER2, LP_HOLDER3], [LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_1], [startTime, startTime, startTime]),
      'R3T: Batch arrays should have same length'
    )

    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 0);
  })

  //sometimes failing due to time set in ganache CLI bug
  it.skip('should be possible to claim manually inserted LPs, to claim new Unlocked LPs, not possible to claim still not claimable LPs', async () => {
    const lpTokenInstance = await IUniswapV2Pair.at(uniswapPair)

    const lpAmount = bn('90').mul(baseUnit)

    //transfer the necessary LP amount to the new liquid vault first
    await lpTokenInstance.transfer(liquidVault.address, lpAmount)

    await rocketToken.transfer(liquidVault.address, '1000000000000000000000')


    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 0)

    const LP_HOLDER3 = accounts[4];
    const LP_HOLDER4 = accounts[5];
    const LP_HOLDER5 = accounts[6];

    const LP_HOLDER_AMOUNT_1 = bn('1').mul(baseUnit).div(bn('10')) // 0.1 LP
    const LP_HOLDER_AMOUNT_2 = bn('5').mul(baseUnit).div(bn('10')) // 0.5 LP
    const LP_HOLDER_AMOUNT_3 = bn('1').mul(baseUnit) // 1 LP
    const LP_HOLDER_AMOUNT_4 = bn('2').mul(baseUnit).div(bn('10')) // 0.2 LP
    const LP_HOLDER_AMOUNT_5 = bn('2').mul(baseUnit) // 2 LP

    const LP_HOLDERS = [
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5,
      LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5, LP_HOLDER, LP_HOLDER2, LP_HOLDER3, LP_HOLDER4, LP_HOLDER5
    ]

    const LP_HOLDER_AMOUNTS = [
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5,
      LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5, LP_HOLDER_AMOUNT_1, LP_HOLDER_AMOUNT_2, LP_HOLDER_AMOUNT_3, LP_HOLDER_AMOUNT_4, LP_HOLDER_AMOUNT_5
    ]

    const startTime2 = startTime + 3600
    const startTime3 = startTime + 7200
    const startTime4 = startTime + 9000
    const startTime5 = startTime + 15000

    const LOCK_START_TIME = [
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5,
      startTime, startTime2, startTime3, startTime4, startTime5, startTime, startTime2, startTime3, startTime4, startTime5
    ]


    await ganache.setTime(startTime)

    const result = await liquidVault.insertUnclaimedBatchFor(LP_HOLDERS, LP_HOLDER_AMOUNTS, LOCK_START_TIME);
    //GAS Price - 200GWEI
    //GAS USED - 3.432.885
    console.log(`gasUsed on 50 insertions via insertUnclaimedBatchFor: ${result.receipt.gasUsed}`)

    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER3), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER4), 10);
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER5), 10);

    const lockPeriod = await liquidVault.getLockedPeriod()


    const purchaseOne = await liquidVault.purchaseLP({ value: bn('3').mul(baseUnit), from: LP_HOLDER2 })
    const holdersLpAmountOne = purchaseOne.receipt.logs[0].args[1]

    await ganache.setTime(bn(startTime).add(bn(50000)))

    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 11);

    const purchaseTwo = await liquidVault.purchaseLP({ value: bn('2').mul(baseUnit), from: LP_HOLDER2 })
    const holdersLpAmountTwo = purchaseTwo.receipt.logs[0].args[1]
    assertBNequal(await liquidVault.lockedLPLength(LP_HOLDER2), 12);

    await ganache.setTime(bn(startTime).add(lockPeriod))

    const lvTotalLP = lpAmount.add(holdersLpAmountOne).add(holdersLpAmountTwo)

    assertBNequal(lvTotalLP, await lpTokenInstance.balanceOf(liquidVault.address))
    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(2))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(3))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(4))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(5))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(6))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(7))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(8))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(9))), await lpTokenInstance.balanceOf(liquidVault.address))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(10))), await lpTokenInstance.balanceOf(liquidVault.address))

    // new batches
    assertBNequal(await liquidVault.queueCounter(LP_HOLDER2), 10)

    const lockedLpData = await liquidVault.getLockedLP(LP_HOLDER2, 10)
    assert.equal(lockedLpData[0], LP_HOLDER2)
    assertBNequal(lockedLpData[1], holdersLpAmountOne)
    assert.isFalse(lockedLpData[3]);


    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(10))).sub(holdersLpAmountOne), await lpTokenInstance.balanceOf(liquidVault.address))

    await expectRevert(
      liquidVault.claimLP({ from: LP_HOLDER2 }),
      'R3T: LP still locked.'
    );

    await ganache.setTime(bn(startTime).add(lockPeriod).add(bn(50020)))

    await liquidVault.claimLP({ from: LP_HOLDER2 })
    assertBNequal(lvTotalLP.sub(LP_HOLDER_AMOUNT_2.mul(bn(10))).sub(holdersLpAmountOne).sub(holdersLpAmountTwo), await lpTokenInstance.balanceOf(liquidVault.address))

    await expectRevert(
      liquidVault.claimLP({ from: LP_HOLDER2 }),
      'R3T: nothing to claim.'
    )
  })

})