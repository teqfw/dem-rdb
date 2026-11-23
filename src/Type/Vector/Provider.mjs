// @ts-check
/**
 * @namespace TeqFw_Dem_RDb_Type_Vector_Provider
 * @description Supplies DEM's relational dense numeric vector extension.
 */
export default class Provider {
    /** Create the vector type provider. */
    constructor() {
        /** @returns {Array<Record<string, any>>} */
        this.getDefinitions=function () { return [{
            name:'teqfw.dem_rdb.vector',
            parameters:{dimensions:'Required positive vector dimension count.'},
            normalizeParams:(/** @type {Record<string, any>} */ params) => {
                if (Object.keys(params).some(name=>name!=='dimensions') || !Number.isSafeInteger(params.dimensions) || params.dimensions<1)
                    throw new TypeError('Vector dimensions must be a positive safe integer.');
                return {dimensions:params.dimensions};
            },
            valueDomain:'A dense fixed-dimension array of finite JavaScript numbers.',
            preservation:'Preserve values in SQLite JSON TEXT; PostgreSQL pgvector storage converts each component to float32 and can lose precision.',
            valueHandling:'Validate an array whose length equals dimensions and whose components are finite numbers; copy the array without float32 normalization.',
            literal:{
                grammar:'A JSON array of exactly dimensions finite numbers.',
                normalize:(/** @type {any} */ value,/** @type {Record<string, any>} */ params) => {
                    if (!Array.isArray(value) || value.length!==params.dimensions || value.some(component=>typeof component!=='number' || !Number.isFinite(component)))
                        throw new TypeError('Vector literal does not match its declared dimensions.');
                    return [...value];
                },
            },
        }]; };
    }
}
