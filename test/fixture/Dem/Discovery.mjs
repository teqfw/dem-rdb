import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import NamespaceRegistry from '@teqfw/di/node/registry/namespace';

const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
const namespaces = await new NamespaceRegistry({fs, path, appRoot}).build();
const selected = namespaces.find(entry => entry.prefix === 'TeqFw_Dem_');
if (!selected) throw new Error('DEM namespace is missing.');
export const demNamespace = selected;

/** @param {TeqFw_Di_Container} container */
export async function acquireDemSchema(container) {
    /** @type {TeqFw_Dem_Acquire} */
    const acquire = await container.get('TeqFw_Dem_Acquire$');
    const result = await acquire.exec({hostRoot: appRoot, packageNames: ['@teqfw/dem']});
    const schema = result.schemas.find(entry => entry.packageName === '@teqfw/dem');
    if (!schema) throw new Error('DEM schema is missing.');
    return schema;
}
