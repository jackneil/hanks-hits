// Test fixture: a module factory with bridge version 0, like an old cached copy of the AAC module.
const createModule = async () => ({ _aac_bridge_abi: () => 0 });
export default createModule;
