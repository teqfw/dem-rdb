import {spawnSync} from 'node:child_process';

const result=spawnSync(process.execPath,['--test','--test-reporter=tap','test/portable/Runtime.test.mjs'],{
    encoding:'utf8',
    env:{...process.env,TEQFW_PORTABLE__CLIENT:'pg'},
});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
if(result.error)throw result.error;
if(result.status!==0 || !/^ok \d+ - pg portable /m.test(result.stdout) || !/^# skipped 0$/m.test(result.stdout) || /# SKIP\b/i.test(result.stdout)) {
    console.error('Required PostgreSQL portable verification failed or skipped tests.');
    process.exitCode=1;
}
