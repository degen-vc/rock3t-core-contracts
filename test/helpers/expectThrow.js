module.exports.handle = async (promise, reason) => {
	try {
		await promise;
		throw "EXPECTED";
	} catch (error) {
		if (error === "EXPECTED")
			assert.fail("expected an error but there was none");
		const message = JSON.stringify(error);
		console.log(error)
		if (!message.includes(reason))
			assert.fail(`expected error:'${reason}' but was ${message}`);
		return;
	}
};
