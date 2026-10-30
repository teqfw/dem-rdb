import {test} from 'node:test';
import assert from 'node:assert/strict';
import Configuration from '../../../src/Api/Configuration.mjs';
test('default configuration requires host composition', async () => {
    const config = new Configuration({errors:{create:({code,message})=>Object.assign(new Error(message),{code})}});
    await assert.rejects(config.get(),{code:'UNSUPPORTED'});
});
