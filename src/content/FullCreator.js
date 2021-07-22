Zotero.FullCreator =
(Zotero["WebPackedFullCreator"] = Zotero["WebPackedFullCreator"] || []).push([["FullCreator"],{

/***/ "./debug.ts":
/*!******************!*\
  !*** ./debug.ts ***!
  \******************/
/*! no static exports found */
/*! all exports used */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
function debug(...msg) {
    const str = `FullCreator: ${msg.map(s => s.toString()).join(' ')}`;
    // console.error(str) // tslint:disable-line:no-console
    Zotero.debug(str);
}
exports.debug = debug;


/***/ }),

/***/ "./monkey-patch.ts":
/*!*************************!*\
  !*** ./monkey-patch.ts ***!
  \*************************/
/*! no static exports found */
/*! all exports used */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const marker = 'FullCreatorMonkeyPatched';
function repatch(object, method, patcher) {
    object[method] = patcher(object[method]);
    object[method][marker] = true;
}
exports.repatch = repatch;
function patch(object, method, patcher) {
    if (object[method][marker])
        throw new Error(`${method} re-patched`);
    repatch(object, method, patcher);
}
exports.patch = patch;


/***/ }),

/***/ "./fullcreator.ts":
/*!********************!*\
  !*** ./fullcreator.ts ***!
  \********************/
/*! no static exports found */
/*! all exports used */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Components.utils.import('resource://gre/modules/AddonManager.jsm');
const monkey_patch_1 = __webpack_require__(/*! ./monkey-patch */ "./monkey-patch.ts");
const debug_1 = __webpack_require__(/*! ./debug */ "./debug.ts");
function htmlencode(text) {
    return `${text}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function plaintext(text) {
    return `${text}`;
}
function getField(item, field) {
    try {
        return item.getField(field) || '';
    }
    catch (err) {
        return '';
    }
}
function getDOI(doi, extra) {
    if (doi)
        return doi;
    if (!extra)
        return '';
    const dois = extra.split('\n').map(line => line.match(/^DOI:\s*(.+)/i)).filter(line => line).map(line => line[1].trim());
    return dois[0] || '';
}
const itemTreeViewWaiting = {};
function getCellX(tree, row, col, field) {
    if (col.id !== 'zotero-items-column-fullcreator')
        return '';
    const item = tree.getRow(row).ref;
    const creators = item.getCreators();
    var fullname = '';
    var chinese_char_pattern = new RegExp("[\u4E00-\u9FA5]+");
   
    creators.map(function (data) {
        if(chinese_char_pattern.test(data.lastName)){
            //is chinese
            fullname += data.lastName + data.firstName + ", ";
        }else{
            //other lang 
            fullname += data.lastName + " " + data.firstName + ", ";
        }
        
    });

    var reg=/,$/gi;
        fullname=fullname.replace(reg,"");
    

    return fullname;
}
monkey_patch_1.patch(Zotero.ItemTreeView.prototype, 'getCellProperties', original => function Zotero_ItemTreeView_prototype_getCellProperties(row, col, prop) {
    return (original.apply(this, arguments) + getCellX(this, row, col, 'properties')).trim();
});
monkey_patch_1.patch(Zotero.ItemTreeView.prototype, 'getCellText', original => function Zotero_ItemTreeView_prototype_getCellText(row, col) {
    if (col.id !== 'zotero-items-column-fullcreator')
        return original.apply(this, arguments);
    return getCellX(this, row, col, 'text');
});
monkey_patch_1.patch(Zotero.Item.prototype, 'getField', original => function Zotero_Item_prototype_getField(field, unformatted, includeBaseMapped) {
    try {
        if (field === 'fullcreator') {
            if (FullCreator.ready.isPending())
                return ''; // tslint:disable-line:no-use-before-declare
            const doi = getDOI(getField(this, 'DOI'), getField(this, 'extra'));
            if (!doi || !FullCreator.feedback[doi])
                return '';
            return ' ';
        }
    }
    catch (err) {
        Zotero.logError(`fullcreator patched getField: ${err}`);
        return '';
    }
    return original.apply(this, arguments);
});
const ready = Zotero.Promise.defer();
class CFullCreator {
    constructor() {
        // public ready: Promise<boolean> = ready.promise
        this.ready = ready.promise;
        this.feedback = {};
        this.users = this.load();
        this.uninstalled = false;
        this.started = false;
        this.bundle = Components.classes['@mozilla.org/intl/stringbundle;1'].getService(Components.interfaces.nsIStringBundleService).createBundle('chrome://zotero-fullcreator/locale/zotero-fullcreator.properties');
    }
    load() {
        try {
            return JSON.parse(Zotero.Prefs.get('fullcreator.users') || '{}');
        }
        catch (err) {
            return {};
        }
    }
    save() {
        Zotero.Prefs.set('fullcreator.users', JSON.stringify(this.users));
    }
    async start() {
        if (this.started)
            return;
        this.started = true;
        await Zotero.Schema.schemaUpdatePromise;
        await this.refresh();
        ready.resolve(true);
        Zotero.Notifier.registerObserver(this, ['item'], 'FullCreator', 1);
    }
    getString(name, params = {}, html = false) {
        if (!this.bundle || typeof this.bundle.GetStringFromName !== 'function') {
            Zotero.logError(`FullCreator.getString(${name}): getString called before strings were loaded`);
            return name;
        }
        let template = name;
        try {
            template = this.bundle.GetStringFromName(name);
        }
        catch (err) {
            Zotero.logError(`FullCreator.getString(${name}): ${err}`);
        }
        const encode = html ? htmlencode : plaintext;
        return template.replace(/{{(.*?)}}/g, (match, param) => encode(params[param] || ''));
    }
    async get(dois, options = {}) {
        var _a, _b;
        const fetch = options.refresh ? dois : dois.filter(doi => !this.feedback[doi]);
        if (fetch.length) {
            try {
                const fullcreator = await Zotero.HTTP.request('POST', 'https://fullcreator.com/v3/publications?devkey=FullCreatorZotero', {
                    body: JSON.stringify({ dois: fetch }),
                    responseType: 'json',
                    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
                });
                for (const feedback of (((_b = (_a = fullcreator) === null || _a === void 0 ? void 0 : _a.response) === null || _b === void 0 ? void 0 : _b.feedbacks) || [])) {
                    if (feedback.last_commented_at.timezone !== 'UTC')
                        debug_1.debug(`FullCreator.get: ${feedback.id} has timezone ${feedback.last_commented_at.timezone}`);
                    this.feedback[feedback.id] = Object.assign(Object.assign({}, feedback), { last_commented_at: new Date(feedback.last_commented_at.date + 'Z'), users: feedback.users.split(/\s*,\s*/).filter(u => u) });
                    for (const user of this.feedback[feedback.id].users) {
                        this.users[user] = this.users[user] || 'neutral';
                    }
                }
            }
            catch (err) {
                debug_1.debug(`FullCreator.get(${fetch}): ${err}`);
            }
        }
        return dois.map(doi => this.feedback[doi]);
    }
    async refresh() {
        const query = `
      SELECT DISTINCT fields.fieldName, itemDataValues.value
      FROM fields
      JOIN itemData on fields.fieldID = itemData.fieldID
      JOIN itemDataValues on itemData.valueID = itemDataValues.valueID
      WHERE fieldname IN ('extra', 'DOI')
    `.replace(/[\s\n]+/g, ' ').trim();
        let dois = [];
        for (const doi of await Zotero.DB.queryAsync(query)) {
            switch (doi.fieldName) {
                case 'extra':
                    dois = dois.concat(doi.value.split('\n').map(line => line.match(/^DOI:\s*(.+)/i)).filter(line => line).map(line => line[1].trim()));
                    break;
                case 'DOI':
                    dois.push(doi.value);
                    break;
            }
        }
        await this.get(dois, { refresh: true });
        setTimeout(this.refresh.bind(this), 24 * 60 * 60 * 1000); // tslint:disable-line:no-magic-numbers
    }
    async notify(action, type, ids, extraData) {
        if (type !== 'item' || (action !== 'modify' && action !== 'add'))
            return;
        const dois = [];
        for (const item of (await Zotero.Items.getAsync(ids))) {
            const doi = getDOI(getField(item, 'DOI'), getField(item, 'extra'));
            if (doi && !dois.includes(doi))
                dois.push(doi);
        }
        if (dois.length)
            await this.get(dois);
    }
}
const FullCreator = new CFullCreator; // tslint:disable-line:variable-name
// used in zoteroPane.ts
AddonManager.addAddonListener({
    onUninstalling(addon, needsRestart) {
        if (addon.id === 'fullcreator@fullcreator.com')
            FullCreator.uninstalled = true;
    },
    onDisabling(addon, needsRestart) { this.onUninstalling(addon, needsRestart); },
    onOperationCancelled(addon, needsRestart) {
        if (addon.id !== 'fullcreator@fullcreator.com')
            return null;
        // tslint:disable-next-line:no-bitwise
        if (addon.pendingOperations & (AddonManager.PENDING_UNINSTALL | AddonManager.PENDING_DISABLE))
            return null;
        delete Zotero.FullCreator.uninstalled;
    },
});
module.exports = FullCreator;


/***/ })

},[["./fullcreator.ts","webpack"]]]);
