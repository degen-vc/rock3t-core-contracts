require('dotenv').config()

const FeeApprover = artifacts.require('FeeApprover')
const FeeDistributor = artifacts.require('FeeDistributor')
const RocketToken = artifacts.require('RocketToken')
const LiquidVault = artifacts.require('LiquidVault')

const { 
    UNISWAP_FACTORY, 
    UNISWAP_ROUTER
} = process.env

module.exports = async function (deployer, network, accounts) {


    if (network === 'development') {
        return;
    }

    await deployer.deploy(FeeApprover)
    const feeApproverInstance = await FeeApprover.deployed()
    await pausePromise('Fee Approver')

    await deployer.deploy(FeeDistributor)
    const feeDistributorInstance = await FeeDistributor.deployed()
    await pausePromise('fee Distributor')

    await deployer.deploy(RocketToken)
    const rocketTokenInstance = await RocketToken.deployed()
    await pausePromise('RocketToken')

    await deployer.deploy(LiquidVault)
    const liquidVaultInstance = await LiquidVault.deployed()
    await pausePromise('liquidity vault')
    
    await rocketTokenInstance.initialSetup(UNISWAP_ROUTER, UNISWAP_FACTORY, feeApproverInstance.address, feeDistributorInstance.address, liquidVaultInstance.address);

    const factoryAddress = await rocketTokenInstance.uniswapFactory.call()
    const routerAddress = await rocketTokenInstance.uniswapRouter.call()

    await pausePromise('seed feedistributor')
    await feeDistributorInstance.seed(rocketTokenInstance.address, liquidVaultInstance.address, accounts[2], 40, 1)
    await pausePromise('seed fee approver')
    await feeApproverInstance.initialize(rocketTokenInstance.address, factoryAddress, routerAddress, liquidVaultInstance.address)
    await pausePromise('seed liquid vault')
    await liquidVaultInstance.seed(2, rocketTokenInstance.address, feeDistributorInstance.address, accounts[2], 10, 10)
}

function pausePromise(message, durationInSeconds = 2) {
	return new Promise(function (resolve, error) {
		setTimeout(() => {
			console.log(message)
			return resolve()
		}, durationInSeconds * 1000)
	})
}