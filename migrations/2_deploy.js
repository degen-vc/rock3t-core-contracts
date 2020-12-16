require('dotenv').config()

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

    await deployer.deploy(FeeDistributor)
    const feeDistributorInstance = await FeeDistributor.deployed()
    await pausePromise('fee Distributor')

    await deployer.deploy(RocketToken, 10, accounts[1])
    const rocketTokenInstance = await RocketToken.deployed()
    await pausePromise('RocketToken')

    await deployer.deploy(LiquidVault)
    const liquidVaultInstance = await LiquidVault.deployed()
    await pausePromise('liquidity vault')
}

function pausePromise(message, durationInSeconds = 2) {
	return new Promise(function (resolve, error) {
		setTimeout(() => {
			console.log(message)
			return resolve()
		}, durationInSeconds * 1000)
	})
}