import {test} from 'node:test';
import assert from 'node:assert/strict';
import Adapter from '../../src/Adapter.mjs';
test('adapter rejects a missing connection', async () => {
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter = new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    await assert.rejects(adapter.open({model:{entities:{}},connection:null}),{code:'INVALID_INPUT'});
    await assert.rejects(adapter.open({model:{entities:{}},knex:null}),{code:'INVALID_INPUT'});
});
