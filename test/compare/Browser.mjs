import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

/** Run the existing real-Chrome harness and read its observation envelope. */
export async function browserObservation({scenario} = {}) {
    const root = process.env.TEQFW_DEM_IDB_ROOT;
    if (!root) throw new Error('TEQFW_DEM_IDB_ROOT must identify the dem-idb checkout.');
    const temp = await mkdtemp(join(tmpdir(), 'dem-compare-'));
    try {
        const output = join(temp, 'idb.json');
        const env = {...process.env, DEM_COMPARE_OUTPUT: output};
        delete env.NODE_TEST_CONTEXT;
        if (scenario) env.DEM_BROWSER_SCENARIO = scenario;
        else delete env.DEM_BROWSER_SCENARIO;
        await promisify(execFile)(process.execPath, ['--test', resolve(root, 'test/browser/Runtime.test.mjs')],
            {cwd: root, env, timeout: 90000, maxBuffer: 8 * 1024 * 1024});
        return JSON.parse(await readFile(output, 'utf8'));
    } finally { await rm(temp, {recursive: true, force: true}); }
}
