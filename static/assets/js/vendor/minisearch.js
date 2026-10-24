/*!
 * MiniSearch 7.2.0 (https://github.com/lucaong/minisearch)
 * Copyright Luca Ongaro. MIT License: https://github.com/lucaong/minisearch/blob/master/LICENSE.txt
 *
 * Built for Henry's Kitchen by tools/build-minisearch.mjs from the official source
 * (commit 3d239d1c): TypeScript types removed and modules joined into one file.
 */
(function (root) {
'use strict';

// ---- SearchableMap/TreeIterator.ts ----
const TreeIteratorModule = (() => {

const ENTRIES = 'ENTRIES';
const KEYS = 'KEYS';
const VALUES = 'VALUES';
const LEAF = '';
class TreeIterator {
    set;
    _type;
    _path;
    constructor(set, type){
        const node = set._tree;
        const keys = Array.from(node.keys());
        this.set = set;
        this._type = type;
        this._path = keys.length > 0 ? [
            {
                node,
                keys
            }
        ] : [];
    }
    next() {
        const value = this.dive();
        this.backtrack();
        return value;
    }
    dive() {
        if (this._path.length === 0) {
            return {
                done: true,
                value: undefined
            };
        }
        const { node, keys } = last(this._path);
        if (last(keys) === LEAF) {
            return {
                done: false,
                value: this.result()
            };
        }
        const child = node.get(last(keys));
        this._path.push({
            node: child,
            keys: Array.from(child.keys())
        });
        return this.dive();
    }
    backtrack() {
        if (this._path.length === 0) {
            return;
        }
        const keys = last(this._path).keys;
        keys.pop();
        if (keys.length > 0) {
            return;
        }
        this._path.pop();
        this.backtrack();
    }
    key() {
        return this.set._prefix + this._path.map(({ keys })=>last(keys)).filter((key)=>key !== LEAF).join('');
    }
    value() {
        return last(this._path).node.get(LEAF);
    }
    result() {
        switch(this._type){
            case VALUES:
                return this.value();
            case KEYS:
                return this.key();
            default:
                return [
                    this.key(),
                    this.value()
                ];
        }
    }
    [Symbol.iterator]() {
        return this;
    }
}
const last = (array)=>{
    return array[array.length - 1];
};

return { TreeIterator, ENTRIES, KEYS, VALUES, LEAF };
})();

// ---- SearchableMap/fuzzySearch.ts ----
const fuzzySearchModule = (() => {
const { LEAF } = TreeIteratorModule;
const fuzzySearch = (node, query, maxDistance)=>{
    const results = new Map();
    if (query === undefined) return results;
    const n = query.length + 1;
    const m = n + maxDistance;
    const matrix = new Uint8Array(m * n).fill(maxDistance + 1);
    for(let j = 0; j < n; ++j)matrix[j] = j;
    for(let i = 1; i < m; ++i)matrix[i * n] = i;
    recurse(node, query, maxDistance, results, matrix, 1, n, '');
    return results;
};
const recurse = (node, query, maxDistance, results, matrix, m, n, prefix)=>{
    const offset = m * n;
    key: for (const key of node.keys()){
        if (key === LEAF) {
            const distance = matrix[offset - 1];
            if (distance <= maxDistance) {
                results.set(prefix, [
                    node.get(key),
                    distance
                ]);
            }
        } else {
            let i = m;
            for(let pos = 0; pos < key.length; ++pos, ++i){
                const char = key[pos];
                const thisRowOffset = n * i;
                const prevRowOffset = thisRowOffset - n;
                let minDistance = matrix[thisRowOffset];
                const jmin = Math.max(0, i - maxDistance - 1);
                const jmax = Math.min(n - 1, i + maxDistance);
                for(let j = jmin; j < jmax; ++j){
                    const different = char !== query[j];
                    const rpl = matrix[prevRowOffset + j] + +different;
                    const del = matrix[prevRowOffset + j + 1] + 1;
                    const ins = matrix[thisRowOffset + j] + 1;
                    const dist = matrix[thisRowOffset + j + 1] = Math.min(rpl, del, ins);
                    if (dist < minDistance) minDistance = dist;
                }
                if (minDistance > maxDistance) {
                    continue key;
                }
            }
            recurse(node.get(key), query, maxDistance, results, matrix, i, n, prefix + key);
        }
    }
};

return { fuzzySearch };
})();

// ---- SearchableMap/SearchableMap.ts ----
const SearchableMapModule = (() => {
const { TreeIterator, ENTRIES, KEYS, VALUES, LEAF } = TreeIteratorModule; const { fuzzySearch } = fuzzySearchModule;
class SearchableMap {
    _tree;
    _prefix;
    _size = undefined;
    constructor(tree = new Map(), prefix = ''){
        this._tree = tree;
        this._prefix = prefix;
    }
    atPrefix(prefix) {
        if (!prefix.startsWith(this._prefix)) {
            throw new Error('Mismatched prefix');
        }
        const [node, path] = trackDown(this._tree, prefix.slice(this._prefix.length));
        if (node === undefined) {
            const [parentNode, key] = last(path);
            for (const k of parentNode.keys()){
                if (k !== LEAF && k.startsWith(key)) {
                    const node = new Map();
                    node.set(k.slice(key.length), parentNode.get(k));
                    return new SearchableMap(node, prefix);
                }
            }
        }
        return new SearchableMap(node, prefix);
    }
    clear() {
        this._size = undefined;
        this._tree.clear();
    }
    delete(key) {
        this._size = undefined;
        return remove(this._tree, key);
    }
    entries() {
        return new TreeIterator(this, ENTRIES);
    }
    forEach(fn) {
        for (const [key, value] of this){
            fn(key, value, this);
        }
    }
    fuzzyGet(key, maxEditDistance) {
        return fuzzySearch(this._tree, key, maxEditDistance);
    }
    get(key) {
        const node = lookup(this._tree, key);
        return node !== undefined ? node.get(LEAF) : undefined;
    }
    has(key) {
        const node = lookup(this._tree, key);
        return node !== undefined && node.has(LEAF);
    }
    keys() {
        return new TreeIterator(this, KEYS);
    }
    set(key, value) {
        if (typeof key !== 'string') {
            throw new Error('key must be a string');
        }
        this._size = undefined;
        const node = createPath(this._tree, key);
        node.set(LEAF, value);
        return this;
    }
    get size() {
        if (this._size) {
            return this._size;
        }
        this._size = 0;
        const iter = this.entries();
        while(!iter.next().done)this._size += 1;
        return this._size;
    }
    update(key, fn) {
        if (typeof key !== 'string') {
            throw new Error('key must be a string');
        }
        this._size = undefined;
        const node = createPath(this._tree, key);
        node.set(LEAF, fn(node.get(LEAF)));
        return this;
    }
    fetch(key, initial) {
        if (typeof key !== 'string') {
            throw new Error('key must be a string');
        }
        this._size = undefined;
        const node = createPath(this._tree, key);
        let value = node.get(LEAF);
        if (value === undefined) {
            node.set(LEAF, value = initial());
        }
        return value;
    }
    values() {
        return new TreeIterator(this, VALUES);
    }
    [Symbol.iterator]() {
        return this.entries();
    }
    static from(entries) {
        const tree = new SearchableMap();
        for (const [key, value] of entries){
            tree.set(key, value);
        }
        return tree;
    }
    static fromObject(object) {
        return SearchableMap.from(Object.entries(object));
    }
}
const trackDown = (tree, key, path = [])=>{
    if (key.length === 0 || tree == null) {
        return [
            tree,
            path
        ];
    }
    for (const k of tree.keys()){
        if (k !== LEAF && key.startsWith(k)) {
            path.push([
                tree,
                k
            ]);
            return trackDown(tree.get(k), key.slice(k.length), path);
        }
    }
    path.push([
        tree,
        key
    ]);
    return trackDown(undefined, '', path);
};
const lookup = (tree, key)=>{
    if (key.length === 0 || tree == null) {
        return tree;
    }
    for (const k of tree.keys()){
        if (k !== LEAF && key.startsWith(k)) {
            return lookup(tree.get(k), key.slice(k.length));
        }
    }
};
const createPath = (node, key)=>{
    const keyLength = key.length;
    outer: for(let pos = 0; node && pos < keyLength;){
        for (const k of node.keys()){
            if (k !== LEAF && key[pos] === k[0]) {
                const len = Math.min(keyLength - pos, k.length);
                let offset = 1;
                while(offset < len && key[pos + offset] === k[offset])++offset;
                const child = node.get(k);
                if (offset === k.length) {
                    node = child;
                } else {
                    const intermediate = new Map();
                    intermediate.set(k.slice(offset), child);
                    node.set(key.slice(pos, pos + offset), intermediate);
                    node.delete(k);
                    node = intermediate;
                }
                pos += offset;
                continue outer;
            }
        }
        const child = new Map();
        node.set(key.slice(pos), child);
        return child;
    }
    return node;
};
const remove = (tree, key)=>{
    const [node, path] = trackDown(tree, key);
    if (node === undefined) {
        return;
    }
    node.delete(LEAF);
    if (node.size === 0) {
        cleanup(path);
    } else if (node.size === 1) {
        const [key, value] = node.entries().next().value;
        merge(path, key, value);
    }
};
const cleanup = (path)=>{
    if (path.length === 0) {
        return;
    }
    const [node, key] = last(path);
    node.delete(key);
    if (node.size === 0) {
        cleanup(path.slice(0, -1));
    } else if (node.size === 1) {
        const [key, value] = node.entries().next().value;
        if (key !== LEAF) {
            merge(path.slice(0, -1), key, value);
        }
    }
};
const merge = (path, key, value)=>{
    if (path.length === 0) {
        return;
    }
    const [node, nodeKey] = last(path);
    node.set(nodeKey + key, value);
    node.delete(nodeKey);
};
const last = (array)=>{
    return array[array.length - 1];
};

return { SearchableMap };
})();

// ---- MiniSearch.ts ----
const MiniSearchModule = (() => {
const { SearchableMap } = SearchableMapModule;
const OR = 'or';
const AND = 'and';
const AND_NOT = 'and_not';
class MiniSearch {
    _options;
    _index;
    _documentCount;
    _documentIds;
    _idToShortId;
    _fieldIds;
    _fieldLength;
    _avgFieldLength;
    _nextId;
    _storedFields;
    _dirtCount;
    _currentVacuum;
    _enqueuedVacuum;
    _enqueuedVacuumConditions;
    static wildcard = Symbol('*');
    constructor(options){
        if (options?.fields == null) {
            throw new Error('MiniSearch: option "fields" must be provided');
        }
        const autoVacuum = options.autoVacuum == null || options.autoVacuum === true ? defaultAutoVacuumOptions : options.autoVacuum;
        this._options = {
            ...defaultOptions,
            ...options,
            autoVacuum,
            searchOptions: {
                ...defaultSearchOptions,
                ...options.searchOptions || {}
            },
            autoSuggestOptions: {
                ...defaultAutoSuggestOptions,
                ...options.autoSuggestOptions || {}
            }
        };
        this._index = new SearchableMap();
        this._documentCount = 0;
        this._documentIds = new Map();
        this._idToShortId = new Map();
        this._fieldIds = {};
        this._fieldLength = new Map();
        this._avgFieldLength = [];
        this._nextId = 0;
        this._storedFields = new Map();
        this._dirtCount = 0;
        this._currentVacuum = null;
        this._enqueuedVacuum = null;
        this._enqueuedVacuumConditions = defaultVacuumConditions;
        this.addFields(this._options.fields);
    }
    add(document) {
        const { extractField, stringifyField, tokenize, processTerm, fields, idField } = this._options;
        const id = extractField(document, idField);
        if (id == null) {
            throw new Error(`MiniSearch: document does not have ID field "${idField}"`);
        }
        if (this._idToShortId.has(id)) {
            throw new Error(`MiniSearch: duplicate ID ${id}`);
        }
        const shortDocumentId = this.addDocumentId(id);
        this.saveStoredFields(shortDocumentId, document);
        for (const field of fields){
            const fieldValue = extractField(document, field);
            if (fieldValue == null) continue;
            const tokens = tokenize(stringifyField(fieldValue, field), field);
            const fieldId = this._fieldIds[field];
            const uniqueTerms = new Set(tokens).size;
            this.addFieldLength(shortDocumentId, fieldId, this._documentCount - 1, uniqueTerms);
            for (const term of tokens){
                const processedTerm = processTerm(term, field);
                if (Array.isArray(processedTerm)) {
                    for (const t of processedTerm){
                        this.addTerm(fieldId, shortDocumentId, t);
                    }
                } else if (processedTerm) {
                    this.addTerm(fieldId, shortDocumentId, processedTerm);
                }
            }
        }
    }
    addAll(documents) {
        for (const document of documents)this.add(document);
    }
    addAllAsync(documents, options = {}) {
        const { chunkSize = 10 } = options;
        const acc = {
            chunk: [],
            promise: Promise.resolve()
        };
        const { chunk, promise } = documents.reduce(({ chunk, promise }, document, i)=>{
            chunk.push(document);
            if ((i + 1) % chunkSize === 0) {
                return {
                    chunk: [],
                    promise: promise.then(()=>new Promise((resolve)=>setTimeout(resolve, 0))).then(()=>this.addAll(chunk))
                };
            } else {
                return {
                    chunk,
                    promise
                };
            }
        }, acc);
        return promise.then(()=>this.addAll(chunk));
    }
    remove(document) {
        const { tokenize, processTerm, extractField, stringifyField, fields, idField } = this._options;
        const id = extractField(document, idField);
        if (id == null) {
            throw new Error(`MiniSearch: document does not have ID field "${idField}"`);
        }
        const shortId = this._idToShortId.get(id);
        if (shortId == null) {
            throw new Error(`MiniSearch: cannot remove document with ID ${id}: it is not in the index`);
        }
        for (const field of fields){
            const fieldValue = extractField(document, field);
            if (fieldValue == null) continue;
            const tokens = tokenize(stringifyField(fieldValue, field), field);
            const fieldId = this._fieldIds[field];
            const uniqueTerms = new Set(tokens).size;
            this.removeFieldLength(shortId, fieldId, this._documentCount, uniqueTerms);
            for (const term of tokens){
                const processedTerm = processTerm(term, field);
                if (Array.isArray(processedTerm)) {
                    for (const t of processedTerm){
                        this.removeTerm(fieldId, shortId, t);
                    }
                } else if (processedTerm) {
                    this.removeTerm(fieldId, shortId, processedTerm);
                }
            }
        }
        this._storedFields.delete(shortId);
        this._documentIds.delete(shortId);
        this._idToShortId.delete(id);
        this._fieldLength.delete(shortId);
        this._documentCount -= 1;
    }
    removeAll(documents) {
        if (documents) {
            for (const document of documents)this.remove(document);
        } else if (arguments.length > 0) {
            throw new Error('Expected documents to be present. Omit the argument to remove all documents.');
        } else {
            this._index = new SearchableMap();
            this._documentCount = 0;
            this._documentIds = new Map();
            this._idToShortId = new Map();
            this._fieldLength = new Map();
            this._avgFieldLength = [];
            this._storedFields = new Map();
            this._nextId = 0;
        }
    }
    discard(id) {
        const shortId = this._idToShortId.get(id);
        if (shortId == null) {
            throw new Error(`MiniSearch: cannot discard document with ID ${id}: it is not in the index`);
        }
        this._idToShortId.delete(id);
        this._documentIds.delete(shortId);
        this._storedFields.delete(shortId);
        (this._fieldLength.get(shortId) || []).forEach((fieldLength, fieldId)=>{
            this.removeFieldLength(shortId, fieldId, this._documentCount, fieldLength);
        });
        this._fieldLength.delete(shortId);
        this._documentCount -= 1;
        this._dirtCount += 1;
        this.maybeAutoVacuum();
    }
    maybeAutoVacuum() {
        if (this._options.autoVacuum === false) {
            return;
        }
        const { minDirtFactor, minDirtCount, batchSize, batchWait } = this._options.autoVacuum;
        this.conditionalVacuum({
            batchSize,
            batchWait
        }, {
            minDirtCount,
            minDirtFactor
        });
    }
    discardAll(ids) {
        const autoVacuum = this._options.autoVacuum;
        try {
            this._options.autoVacuum = false;
            for (const id of ids){
                this.discard(id);
            }
        } finally{
            this._options.autoVacuum = autoVacuum;
        }
        this.maybeAutoVacuum();
    }
    replace(updatedDocument) {
        const { idField, extractField } = this._options;
        const id = extractField(updatedDocument, idField);
        this.discard(id);
        this.add(updatedDocument);
    }
    vacuum(options = {}) {
        return this.conditionalVacuum(options);
    }
    conditionalVacuum(options, conditions) {
        if (this._currentVacuum) {
            this._enqueuedVacuumConditions = this._enqueuedVacuumConditions && conditions;
            if (this._enqueuedVacuum != null) {
                return this._enqueuedVacuum;
            }
            this._enqueuedVacuum = this._currentVacuum.then(()=>{
                const conditions = this._enqueuedVacuumConditions;
                this._enqueuedVacuumConditions = defaultVacuumConditions;
                return this.performVacuuming(options, conditions);
            });
            return this._enqueuedVacuum;
        }
        if (this.vacuumConditionsMet(conditions) === false) {
            return Promise.resolve();
        }
        this._currentVacuum = this.performVacuuming(options);
        return this._currentVacuum;
    }
    async performVacuuming(options, conditions) {
        const initialDirtCount = this._dirtCount;
        if (this.vacuumConditionsMet(conditions)) {
            const batchSize = options.batchSize || defaultVacuumOptions.batchSize;
            const batchWait = options.batchWait || defaultVacuumOptions.batchWait;
            let i = 1;
            for (const [term, fieldsData] of this._index){
                for (const [fieldId, fieldIndex] of fieldsData){
                    for (const [shortId] of fieldIndex){
                        if (this._documentIds.has(shortId)) {
                            continue;
                        }
                        if (fieldIndex.size <= 1) {
                            fieldsData.delete(fieldId);
                        } else {
                            fieldIndex.delete(shortId);
                        }
                    }
                }
                if (this._index.get(term).size === 0) {
                    this._index.delete(term);
                }
                if (i % batchSize === 0) {
                    await new Promise((resolve)=>setTimeout(resolve, batchWait));
                }
                i += 1;
            }
            this._dirtCount -= initialDirtCount;
        }
        await null;
        this._currentVacuum = this._enqueuedVacuum;
        this._enqueuedVacuum = null;
    }
    vacuumConditionsMet(conditions) {
        if (conditions == null) {
            return true;
        }
        let { minDirtCount, minDirtFactor } = conditions;
        minDirtCount = minDirtCount || defaultAutoVacuumOptions.minDirtCount;
        minDirtFactor = minDirtFactor || defaultAutoVacuumOptions.minDirtFactor;
        return this.dirtCount >= minDirtCount && this.dirtFactor >= minDirtFactor;
    }
    get isVacuuming() {
        return this._currentVacuum != null;
    }
    get dirtCount() {
        return this._dirtCount;
    }
    get dirtFactor() {
        return this._dirtCount / (1 + this._documentCount + this._dirtCount);
    }
    has(id) {
        return this._idToShortId.has(id);
    }
    getStoredFields(id) {
        const shortId = this._idToShortId.get(id);
        if (shortId == null) {
            return undefined;
        }
        return this._storedFields.get(shortId);
    }
    search(query, searchOptions = {}) {
        const { searchOptions: globalSearchOptions } = this._options;
        const searchOptionsWithDefaults = {
            ...globalSearchOptions,
            ...searchOptions
        };
        const rawResults = this.executeQuery(query, searchOptions);
        const results = [];
        for (const [docId, { score, terms, match }] of rawResults){
            const quality = terms.length || 1;
            const result = {
                id: this._documentIds.get(docId),
                score: score * quality,
                terms: Object.keys(match),
                queryTerms: terms,
                match
            };
            Object.assign(result, this._storedFields.get(docId));
            if (searchOptionsWithDefaults.filter == null || searchOptionsWithDefaults.filter(result)) {
                results.push(result);
            }
        }
        if (query === MiniSearch.wildcard && searchOptionsWithDefaults.boostDocument == null) {
            return results;
        }
        results.sort(byScore);
        return results;
    }
    autoSuggest(queryString, options = {}) {
        options = {
            ...this._options.autoSuggestOptions,
            ...options
        };
        const suggestions = new Map();
        for (const { score, terms } of this.search(queryString, options)){
            const phrase = terms.join(' ');
            const suggestion = suggestions.get(phrase);
            if (suggestion != null) {
                suggestion.score += score;
                suggestion.count += 1;
            } else {
                suggestions.set(phrase, {
                    score,
                    terms,
                    count: 1
                });
            }
        }
        const results = [];
        for (const [suggestion, { score, terms, count }] of suggestions){
            results.push({
                suggestion,
                terms,
                score: score / count
            });
        }
        results.sort(byScore);
        return results;
    }
    get documentCount() {
        return this._documentCount;
    }
    get termCount() {
        return this._index.size;
    }
    static loadJSON(json, options) {
        if (options == null) {
            throw new Error('MiniSearch: loadJSON should be given the same options used when serializing the index');
        }
        return this.loadJS(JSON.parse(json), options);
    }
    static async loadJSONAsync(json, options) {
        if (options == null) {
            throw new Error('MiniSearch: loadJSON should be given the same options used when serializing the index');
        }
        return this.loadJSAsync(JSON.parse(json), options);
    }
    static getDefault(optionName) {
        if (defaultOptions.hasOwnProperty(optionName)) {
            return getOwnProperty(defaultOptions, optionName);
        } else {
            throw new Error(`MiniSearch: unknown option "${optionName}"`);
        }
    }
    static loadJS(js, options) {
        const { index, documentIds, fieldLength, storedFields, serializationVersion } = js;
        const miniSearch = this.instantiateMiniSearch(js, options);
        miniSearch._documentIds = objectToNumericMap(documentIds);
        miniSearch._fieldLength = objectToNumericMap(fieldLength);
        miniSearch._storedFields = objectToNumericMap(storedFields);
        for (const [shortId, id] of miniSearch._documentIds){
            miniSearch._idToShortId.set(id, shortId);
        }
        for (const [term, data] of index){
            const dataMap = new Map();
            for (const fieldId of Object.keys(data)){
                let indexEntry = data[fieldId];
                if (serializationVersion === 1) {
                    indexEntry = indexEntry.ds;
                }
                dataMap.set(parseInt(fieldId, 10), objectToNumericMap(indexEntry));
            }
            miniSearch._index.set(term, dataMap);
        }
        return miniSearch;
    }
    static async loadJSAsync(js, options) {
        const { index, documentIds, fieldLength, storedFields, serializationVersion } = js;
        const miniSearch = this.instantiateMiniSearch(js, options);
        miniSearch._documentIds = await objectToNumericMapAsync(documentIds);
        miniSearch._fieldLength = await objectToNumericMapAsync(fieldLength);
        miniSearch._storedFields = await objectToNumericMapAsync(storedFields);
        for (const [shortId, id] of miniSearch._documentIds){
            miniSearch._idToShortId.set(id, shortId);
        }
        let count = 0;
        for (const [term, data] of index){
            const dataMap = new Map();
            for (const fieldId of Object.keys(data)){
                let indexEntry = data[fieldId];
                if (serializationVersion === 1) {
                    indexEntry = indexEntry.ds;
                }
                dataMap.set(parseInt(fieldId, 10), await objectToNumericMapAsync(indexEntry));
            }
            if (++count % 1000 === 0) await wait(0);
            miniSearch._index.set(term, dataMap);
        }
        return miniSearch;
    }
    static instantiateMiniSearch(js, options) {
        const { documentCount, nextId, fieldIds, averageFieldLength, dirtCount, serializationVersion } = js;
        if (serializationVersion !== 1 && serializationVersion !== 2) {
            throw new Error('MiniSearch: cannot deserialize an index created with an incompatible version');
        }
        const miniSearch = new MiniSearch(options);
        miniSearch._documentCount = documentCount;
        miniSearch._nextId = nextId;
        miniSearch._idToShortId = new Map();
        miniSearch._fieldIds = fieldIds;
        miniSearch._avgFieldLength = averageFieldLength;
        miniSearch._dirtCount = dirtCount || 0;
        miniSearch._index = new SearchableMap();
        return miniSearch;
    }
    executeQuery(query, searchOptions = {}) {
        if (query === MiniSearch.wildcard) {
            return this.executeWildcardQuery(searchOptions);
        }
        if (typeof query !== 'string') {
            const options = {
                ...searchOptions,
                ...query,
                queries: undefined
            };
            const results = query.queries.map((subquery)=>this.executeQuery(subquery, options));
            return this.combineResults(results, options.combineWith);
        }
        const { tokenize, processTerm, searchOptions: globalSearchOptions } = this._options;
        const options = {
            tokenize,
            processTerm,
            ...globalSearchOptions,
            ...searchOptions
        };
        const { tokenize: searchTokenize, processTerm: searchProcessTerm } = options;
        const terms = searchTokenize(query).flatMap((term)=>searchProcessTerm(term)).filter((term)=>!!term);
        const queries = terms.map(termToQuerySpec(options));
        const results = queries.map((query)=>this.executeQuerySpec(query, options));
        return this.combineResults(results, options.combineWith);
    }
    executeQuerySpec(query, searchOptions) {
        const options = {
            ...this._options.searchOptions,
            ...searchOptions
        };
        const boosts = (options.fields || this._options.fields).reduce((boosts, field)=>({
                ...boosts,
                [field]: getOwnProperty(options.boost, field) || 1
            }), {});
        const { boostDocument, weights, maxFuzzy, bm25: bm25params } = options;
        const { fuzzy: fuzzyWeight, prefix: prefixWeight } = {
            ...defaultSearchOptions.weights,
            ...weights
        };
        const data = this._index.get(query.term);
        const results = this.termResults(query.term, query.term, 1, query.termBoost, data, boosts, boostDocument, bm25params);
        let prefixMatches;
        let fuzzyMatches;
        if (query.prefix) {
            prefixMatches = this._index.atPrefix(query.term);
        }
        if (query.fuzzy) {
            const fuzzy = query.fuzzy === true ? 0.2 : query.fuzzy;
            const maxDistance = fuzzy < 1 ? Math.min(maxFuzzy, Math.round(query.term.length * fuzzy)) : fuzzy;
            if (maxDistance) fuzzyMatches = this._index.fuzzyGet(query.term, maxDistance);
        }
        if (prefixMatches) {
            for (const [term, data] of prefixMatches){
                const distance = term.length - query.term.length;
                if (!distance) {
                    continue;
                }
                fuzzyMatches?.delete(term);
                const weight = prefixWeight * term.length / (term.length + 0.3 * distance);
                this.termResults(query.term, term, weight, query.termBoost, data, boosts, boostDocument, bm25params, results);
            }
        }
        if (fuzzyMatches) {
            for (const term of fuzzyMatches.keys()){
                const [data, distance] = fuzzyMatches.get(term);
                if (!distance) {
                    continue;
                }
                const weight = fuzzyWeight * term.length / (term.length + distance);
                this.termResults(query.term, term, weight, query.termBoost, data, boosts, boostDocument, bm25params, results);
            }
        }
        return results;
    }
    executeWildcardQuery(searchOptions) {
        const results = new Map();
        const options = {
            ...this._options.searchOptions,
            ...searchOptions
        };
        for (const [shortId, id] of this._documentIds){
            const score = options.boostDocument ? options.boostDocument(id, '', this._storedFields.get(shortId)) : 1;
            results.set(shortId, {
                score,
                terms: [],
                match: {}
            });
        }
        return results;
    }
    combineResults(results, combineWith = OR) {
        if (results.length === 0) {
            return new Map();
        }
        const operator = combineWith.toLowerCase();
        const combinator = combinators[operator];
        if (!combinator) {
            throw new Error(`Invalid combination operator: ${combineWith}`);
        }
        return results.reduce(combinator) || new Map();
    }
    toJSON() {
        const index = [];
        for (const [term, fieldIndex] of this._index){
            const data = {};
            for (const [fieldId, freqs] of fieldIndex){
                data[fieldId] = Object.fromEntries(freqs);
            }
            index.push([
                term,
                data
            ]);
        }
        return {
            documentCount: this._documentCount,
            nextId: this._nextId,
            documentIds: Object.fromEntries(this._documentIds),
            fieldIds: this._fieldIds,
            fieldLength: Object.fromEntries(this._fieldLength),
            averageFieldLength: this._avgFieldLength,
            storedFields: Object.fromEntries(this._storedFields),
            dirtCount: this._dirtCount,
            index,
            serializationVersion: 2
        };
    }
    termResults(sourceTerm, derivedTerm, termWeight, termBoost, fieldTermData, fieldBoosts, boostDocumentFn, bm25params, results = new Map()) {
        if (fieldTermData == null) return results;
        for (const field of Object.keys(fieldBoosts)){
            const fieldBoost = fieldBoosts[field];
            const fieldId = this._fieldIds[field];
            const fieldTermFreqs = fieldTermData.get(fieldId);
            if (fieldTermFreqs == null) continue;
            let matchingFields = fieldTermFreqs.size;
            const avgFieldLength = this._avgFieldLength[fieldId];
            for (const docId of fieldTermFreqs.keys()){
                if (!this._documentIds.has(docId)) {
                    this.removeTerm(fieldId, docId, derivedTerm);
                    matchingFields -= 1;
                    continue;
                }
                const docBoost = boostDocumentFn ? boostDocumentFn(this._documentIds.get(docId), derivedTerm, this._storedFields.get(docId)) : 1;
                if (!docBoost) continue;
                const termFreq = fieldTermFreqs.get(docId);
                const fieldLength = this._fieldLength.get(docId)[fieldId];
                const rawScore = calcBM25Score(termFreq, matchingFields, this._documentCount, fieldLength, avgFieldLength, bm25params);
                const weightedScore = termWeight * termBoost * fieldBoost * docBoost * rawScore;
                const result = results.get(docId);
                if (result) {
                    result.score += weightedScore;
                    assignUniqueTerm(result.terms, sourceTerm);
                    const match = getOwnProperty(result.match, derivedTerm);
                    if (match) {
                        match.push(field);
                    } else {
                        result.match[derivedTerm] = [
                            field
                        ];
                    }
                } else {
                    results.set(docId, {
                        score: weightedScore,
                        terms: [
                            sourceTerm
                        ],
                        match: {
                            [derivedTerm]: [
                                field
                            ]
                        }
                    });
                }
            }
        }
        return results;
    }
    addTerm(fieldId, documentId, term) {
        const indexData = this._index.fetch(term, createMap);
        let fieldIndex = indexData.get(fieldId);
        if (fieldIndex == null) {
            fieldIndex = new Map();
            fieldIndex.set(documentId, 1);
            indexData.set(fieldId, fieldIndex);
        } else {
            const docs = fieldIndex.get(documentId);
            fieldIndex.set(documentId, (docs || 0) + 1);
        }
    }
    removeTerm(fieldId, documentId, term) {
        if (!this._index.has(term)) {
            this.warnDocumentChanged(documentId, fieldId, term);
            return;
        }
        const indexData = this._index.fetch(term, createMap);
        const fieldIndex = indexData.get(fieldId);
        if (fieldIndex == null || fieldIndex.get(documentId) == null) {
            this.warnDocumentChanged(documentId, fieldId, term);
        } else if (fieldIndex.get(documentId) <= 1) {
            if (fieldIndex.size <= 1) {
                indexData.delete(fieldId);
            } else {
                fieldIndex.delete(documentId);
            }
        } else {
            fieldIndex.set(documentId, fieldIndex.get(documentId) - 1);
        }
        if (this._index.get(term).size === 0) {
            this._index.delete(term);
        }
    }
    warnDocumentChanged(shortDocumentId, fieldId, term) {
        for (const fieldName of Object.keys(this._fieldIds)){
            if (this._fieldIds[fieldName] === fieldId) {
                this._options.logger('warn', `MiniSearch: document with ID ${this._documentIds.get(shortDocumentId)} has changed before removal: term "${term}" was not present in field "${fieldName}". Removing a document after it has changed can corrupt the index!`, 'version_conflict');
                return;
            }
        }
    }
    addDocumentId(documentId) {
        const shortDocumentId = this._nextId;
        this._idToShortId.set(documentId, shortDocumentId);
        this._documentIds.set(shortDocumentId, documentId);
        this._documentCount += 1;
        this._nextId += 1;
        return shortDocumentId;
    }
    addFields(fields) {
        for(let i = 0; i < fields.length; i++){
            this._fieldIds[fields[i]] = i;
        }
    }
    addFieldLength(documentId, fieldId, count, length) {
        let fieldLengths = this._fieldLength.get(documentId);
        if (fieldLengths == null) this._fieldLength.set(documentId, fieldLengths = []);
        fieldLengths[fieldId] = length;
        const averageFieldLength = this._avgFieldLength[fieldId] || 0;
        const totalFieldLength = averageFieldLength * count + length;
        this._avgFieldLength[fieldId] = totalFieldLength / (count + 1);
    }
    removeFieldLength(documentId, fieldId, count, length) {
        if (count === 1) {
            this._avgFieldLength[fieldId] = 0;
            return;
        }
        const totalFieldLength = this._avgFieldLength[fieldId] * count - length;
        this._avgFieldLength[fieldId] = totalFieldLength / (count - 1);
    }
    saveStoredFields(documentId, doc) {
        const { storeFields, extractField } = this._options;
        if (storeFields == null || storeFields.length === 0) {
            return;
        }
        let documentFields = this._storedFields.get(documentId);
        if (documentFields == null) this._storedFields.set(documentId, documentFields = {});
        for (const fieldName of storeFields){
            const fieldValue = extractField(doc, fieldName);
            if (fieldValue !== undefined) documentFields[fieldName] = fieldValue;
        }
    }
}
const getOwnProperty = (object, property)=>Object.prototype.hasOwnProperty.call(object, property) ? object[property] : undefined;
const combinators = {
    [OR]: (a, b)=>{
        for (const docId of b.keys()){
            const existing = a.get(docId);
            if (existing == null) {
                a.set(docId, b.get(docId));
            } else {
                const { score, terms, match } = b.get(docId);
                existing.score = existing.score + score;
                existing.match = Object.assign(existing.match, match);
                assignUniqueTerms(existing.terms, terms);
            }
        }
        return a;
    },
    [AND]: (a, b)=>{
        const combined = new Map();
        for (const docId of b.keys()){
            const existing = a.get(docId);
            if (existing == null) continue;
            const { score, terms, match } = b.get(docId);
            assignUniqueTerms(existing.terms, terms);
            combined.set(docId, {
                score: existing.score + score,
                terms: existing.terms,
                match: Object.assign(existing.match, match)
            });
        }
        return combined;
    },
    [AND_NOT]: (a, b)=>{
        for (const docId of b.keys())a.delete(docId);
        return a;
    }
};
const defaultBM25params = {
    k: 1.2,
    b: 0.7,
    d: 0.5
};
const calcBM25Score = (termFreq, matchingCount, totalCount, fieldLength, avgFieldLength, bm25params)=>{
    const { k, b, d } = bm25params;
    const invDocFreq = Math.log(1 + (totalCount - matchingCount + 0.5) / (matchingCount + 0.5));
    return invDocFreq * (d + termFreq * (k + 1) / (termFreq + k * (1 - b + b * fieldLength / avgFieldLength)));
};
const termToQuerySpec = (options)=>(term, i, terms)=>{
        const fuzzy = typeof options.fuzzy === 'function' ? options.fuzzy(term, i, terms) : options.fuzzy || false;
        const prefix = typeof options.prefix === 'function' ? options.prefix(term, i, terms) : options.prefix === true;
        const termBoost = typeof options.boostTerm === 'function' ? options.boostTerm(term, i, terms) : 1;
        return {
            term,
            fuzzy,
            prefix,
            termBoost
        };
    };
const defaultOptions = {
    idField: 'id',
    extractField: (document, fieldName)=>document[fieldName],
    stringifyField: (fieldValue, fieldName)=>fieldValue.toString(),
    tokenize: (text)=>text.split(SPACE_OR_PUNCTUATION),
    processTerm: (term)=>term.toLowerCase(),
    fields: undefined,
    searchOptions: undefined,
    storeFields: [],
    logger: (level, message)=>{
        if (typeof console?.[level] === 'function') console[level](message);
    },
    autoVacuum: true
};
const defaultSearchOptions = {
    combineWith: OR,
    prefix: false,
    fuzzy: false,
    maxFuzzy: 6,
    boost: {},
    weights: {
        fuzzy: 0.45,
        prefix: 0.375
    },
    bm25: defaultBM25params
};
const defaultAutoSuggestOptions = {
    combineWith: AND,
    prefix: (term, i, terms)=>i === terms.length - 1
};
const defaultVacuumOptions = {
    batchSize: 1000,
    batchWait: 10
};
const defaultVacuumConditions = {
    minDirtFactor: 0.1,
    minDirtCount: 20
};
const defaultAutoVacuumOptions = {
    ...defaultVacuumOptions,
    ...defaultVacuumConditions
};
const assignUniqueTerm = (target, term)=>{
    if (!target.includes(term)) target.push(term);
};
const assignUniqueTerms = (target, source)=>{
    for (const term of source){
        if (!target.includes(term)) target.push(term);
    }
};
const byScore = ({ score: a }, { score: b })=>b - a;
const createMap = ()=>new Map();
const objectToNumericMap = (object)=>{
    const map = new Map();
    for (const key of Object.keys(object)){
        map.set(parseInt(key, 10), object[key]);
    }
    return map;
};
const objectToNumericMapAsync = async (object)=>{
    const map = new Map();
    let count = 0;
    for (const key of Object.keys(object)){
        map.set(parseInt(key, 10), object[key]);
        if (++count % 1000 === 0) {
            await wait(0);
        }
    }
    return map;
};
const wait = (ms)=>new Promise((resolve)=>setTimeout(resolve, ms));
const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;

return { MiniSearch };
})();

const MiniSearch = MiniSearchModule.MiniSearch;
if (typeof module === 'object' && module.exports) { module.exports = MiniSearch; } else { root.MiniSearch = MiniSearch; }
})(typeof self !== 'undefined' ? self : this);
