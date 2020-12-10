
const { expectEvent } = require("@openzeppelin/test-helpers")
const async = require('./helpers/async.js')
const expectThrow = require('./helpers/expectThrow').handle
const time = require('./helpers/time')
const test = async.test
const setup = async.setup
const hardcore = artifacts.require("RocketToken")
const distributor = artifacts.require("FeeDistributor")
const feeApprover = artifacts.require("FeeApprover")
const liquidVault = artifacts.require("LiquidVault")
const uniswapPairABI = artifacts.require('UniswapV2Pair').abi

function toBn(input) {
    return web3.utils.toBN(input)
}

let primary = ""
contract('liquid vault', accounts => {
    var hardcoreInstance, liquidVaultInstance, feeAproverInstance, distributorInstance
    const primaryOptions = { from: accounts[0], gas: "0x6091b7" }
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

    setup(async () => {
        hardcoreInstance = await hardcore.deployed()
        liquidVaultInstance = await liquidVault.deployed()
        feeAproverInstance = await feeApprover.deployed()
        distributorInstance = await distributor.deployed()
        await feeAproverInstance.unPause()
        primary = accounts[0]
        await hardcoreInstance.transfer(distributorInstance.address, "25000000000")
    })

    test("purchaseLP with no eth fails", async () => {
        await expectThrow(liquidVaultInstance.purchaseLP({ value: '0' }), 'LiquidVault: eth required to mint tokens LP')
    })

    test('setParameters from non-owner fails', async () => {
        await expectThrow(liquidVaultInstance.setParameters(2, 10, 5, { from: accounts[3] }), 'Ownable: caller is not the owner')
    })

    test('setEthFeeAddress with zero addresses fails', async () => {
        await expectThrow(liquidVaultInstance.setEthFeeAddress(ZERO_ADDRESS), 'LiquidVault: eth receiver is zero address')
    })

    test('sending eth on purchase increases queue size by 1', async () => {
        await liquidVaultInstance.setEthFeeAddress(accounts[1])
        const lengthBefore = (await liquidVaultInstance.lockedLPLength.call(accounts[0])).toNumber()
        const ethReceiverBalanceBefore = await web3.eth.getBalance(accounts[1])

        const liquidVaultHcoreBalance = await hardcoreInstance.balanceOf(liquidVaultInstance.address)
        const { hardCoreRequired } = await liquidVaultInstance.calculateTokensRequired('100000000000')

        assert.isAtLeast(Number(liquidVaultHcoreBalance), Number(hardCoreRequired))

        const ethAmount = web3.utils.toWei('10')
        const hcoreAmount = web3.utils.toWei('100')
        const deadline = new Date().getTime() + 3000
        
        await hardcoreInstance.approve(router.address, hcoreAmount)
        await router.addLiquidityETH(hardcoreInstance.address, hcoreAmount, '0', '0', owner, deadline, { 
            value: ethAmount, from: owner 
        })
        
        const purchase = await liquidVaultInstance.purchaseLP({ value: '100000000000' })
        const ethReceiverBalanceAfter = await web3.eth.getBalance(accounts[1])
        const feeAmount = purchase.receipt.logs[1].args[3].toString()
        const ethForPurchase = purchase.receipt.logs[1].args[2].toString()
        const lengthAfter = (await liquidVaultInstance.lockedLPLength.call(accounts[0])).toNumber()
        const expectedFeeAmount = '10000000000'

        assert.equal(feeAmount, expectedFeeAmount)
        assert.equal(ethForPurchase, '90000000000')
        assert.equal(lengthAfter - lengthBefore, 1)
        assert.equal(toBn(ethReceiverBalanceBefore).add(toBn(expectedFeeAmount)).toString(), ethReceiverBalanceAfter)

        const lp = await liquidVaultInstance.getLockedLP.call(accounts[0], lengthAfter - 1)
        const sender = lp[0].toString()
        const amount = lp[1].toNumber()
        const timestamp = lp[2].toNumber()
        assert.equal(sender, accounts[0])
        assert.isAbove(amount, 0)
        assert.isAbove(timestamp, 0)

        await hardcoreInstance.transfer(distributorInstance.address, "1000000000")
        await liquidVaultInstance.purchaseLP({ value: '7000000' })

        const lengthAfterSecondPurchase = (await liquidVaultInstance.lockedLPLength.call(accounts[0])).toNumber()
        assert.equal(lengthAfterSecondPurchase - lengthAfter, 1)

        const lp2 = await liquidVaultInstance.getLockedLP.call(accounts[0], lengthAfterSecondPurchase - 1)
        
        const sender2 = lp2[0].toString()
        const amount2 = lp2[1].toNumber()
        const timestamp2 = lp2[2].toNumber()
        assert.equal(sender2, accounts[0])
        assert.isAbove(amount2, 0)
        assert.isAbove(timestamp2, 0)

        await expectThrow(liquidVaultInstance.purchaseLP({ value: '250000000000' }), "LiquidVault: insufficient tokens in LiquidVault")

        await expectThrow(liquidVaultInstance.claimLP({ from: accounts[3] }), "LiquidVault: No locked LP.")

        await expectThrow(liquidVaultInstance.claimLP(), "LiquidVault: LP still locked.")

        await time.advanceTime(172801) //just over 2 days

        const lpAddress = (await hardcoreInstance.tokenUniswapPair.call()).toString()
        console.log('LPADDRESS: ' + lpAddress)
        const lpTokenInstance = (await new web3.eth.Contract(uniswapPairABI, lpAddress))

        const lpBalaceBefore = parseInt((await lpTokenInstance.methods.balanceOf(accounts[0]).call({ from: primary })).toString())
        assert.equal(lpBalaceBefore, 0)

        const length = Number(await liquidVaultInstance.lockedLPLength.call(accounts[0]))
        const lockedLP = await liquidVaultInstance.getLockedLP.call(accounts[0], length - 1)
        const amountToClaim = Number(lockedLP[1])
        
        const claim = await liquidVaultInstance.claimLP()
        const claimedAmount = Number(claim.receipt.logs[0].args[1])
        
        const expectedFee = parseInt((10 * amountToClaim) / 100)
        const exitFee = Number(claim.receipt.logs[0].args[3])

        expectEvent.inTransaction(claim.tx, lpTokenInstance, 'Transfer', {
            from: liquidVaultInstance.address,
            to: ZERO_ADDRESS,
            value: exitFee.toString()
        })

        const lengthAfterClaim = (await liquidVaultInstance.lockedLPLength.call(accounts[0])).toNumber()
        assert.equal(lengthAfterClaim, lengthAfterSecondPurchase - 1)
        const lpBalanceAfterClaim = parseInt((await lpTokenInstance.methods.balanceOf(accounts[0]).call({ from: primary })).toString())
        
        assert.equal(amountToClaim, claimedAmount)
        assert.equal(expectedFee, exitFee)
        assert.equal(lpBalanceAfterClaim, claimedAmount - exitFee)

        const length2 = Number(await liquidVaultInstance.lockedLPLength.call(accounts[0]))
        const lockedLP2 = await liquidVaultInstance.getLockedLP.call(accounts[0], length2 - 1)
        const amountToClaim2 = Number(lockedLP2[1])

        const claim2 = await liquidVaultInstance.claimLP()
        const claimedAmount2 = Number(claim2.receipt.logs[0].args[1])

        const expectedFee2 = parseInt((10 * amountToClaim2) / 100)
        const exitFee2 = Number(claim2.receipt.logs[0].args[3])

        expectEvent.inTransaction(claim2.tx, lpTokenInstance, 'Transfer', {
            from: liquidVaultInstance.address,
            to: ZERO_ADDRESS,
            value: exitFee2.toString()
        })

        const lengthAfterSecondClaim = (await liquidVaultInstance.lockedLPLength.call(accounts[0])).toNumber()
        assert.equal(lengthAfterSecondClaim, lengthAfterClaim - 1)
        const lpBalaceAfterSecondClaim = parseInt((await lpTokenInstance.methods.balanceOf(accounts[0]).call({ from: primary })).toString())

        assert.equal(amountToClaim2, claimedAmount2)
        assert.equal(expectedFee2, exitFee2)
        assert.equal(lpBalaceAfterSecondClaim, lpBalanceAfterClaim + (claimedAmount2 - exitFee2))
    })

    test("transferGrab sends tokens while increasing LP balance", async () => {
        const lpAddress = (await hardcoreInstance.tokenUniswapPair.call()).toString()
        console.log('LPADDRESS: ' + lpAddress)
        const lpTokenInstance = (await new web3.eth.Contract(uniswapPairABI, lpAddress))

        await hardcoreInstance.transfer(distributorInstance.address, "100000000000")

        await hardcoreInstance.transfer(accounts[4], "25000000000")

        const lockedLengthBefore= (await liquidVaultInstance.lockedLPLength.call(accounts[4])).toNumber()
        assert.equal(lockedLengthBefore,0)
       
        await hardcoreInstance.transferGrabLP(accounts[5], '10000000', { from: accounts[4], value: 20000 })

        const balanceOf5 = (await hardcoreInstance.balanceOf.call(accounts[5])).toString()
        assert.equal(balanceOf5, "9000000")

        const lockedLPLengthAfter= (await liquidVaultInstance.lockedLPLength.call(accounts[4])).toNumber()
        assert.equal(lockedLPLengthAfter,1)

        const lp = await liquidVaultInstance.getLockedLP.call(accounts[4], 0)
        const sender = lp[0].toString()
        const amount = lp[1].toNumber()
        const timestamp = lp[2].toNumber()

        assert.equal(sender,accounts[4])
        assert.isAbove(amount,0)
    })

})
