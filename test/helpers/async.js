module.exports.test = function (message, functionToTest) {
	it(message, (done) => {
		functionToTest()
			.then(done)
			.catch(error => { done(error); });
	});
}

module.exports.setup = function (beforePromise) {
	before(done => {
		beforePromise()
			.then(done)
			.catch(error => done(error))
	})
}

module.exports.getBalancePromise = function (account, timeout) {
	timeout == null ? 1 : timeout;
	return new Promise(function (resolve, error) {
		setTimeout(() => {
			return web3.eth.getBalance(account, function (err, hashValue) {

				if (err)
					return error(err);
				else {
					return resolve(hashValue);
				}
			});
		}, timeout);
	});
}
