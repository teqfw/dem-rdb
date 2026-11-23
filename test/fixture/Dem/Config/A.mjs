// @ts-check
/** @namespace Test_Dem_Config_A @description Host placement A configuration. */
export default class ConfigA {
    constructor() {
        /** @type {Record<string, any>|undefined} */
        let options;
        this.init=(/** @type {Record<string, any>} */ value)=>{if(options)throw new Error('Configuration is already initialized.');options={...value};};
        this.get=async()=>{if(!options)throw new Error('Configuration is not initialized.');return options;};
    }
}
