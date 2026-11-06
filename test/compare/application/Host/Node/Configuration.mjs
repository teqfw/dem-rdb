// @ts-check
/** @namespace Host_Node_Configuration @description Comparison host model configuration. */
export default class Configuration {
    constructor() {
        let options;
        this.set=value=>{options=value;};
        this.get=async()=>{if(!options)throw new Error('Host is not configured.');return options;};
    }
}
