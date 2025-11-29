// deno-lint-ignore-file no-explicit-any

export const isNotEmpty: Rule<string> = (str, msg) => msg && msg('cannot be empty') || str !== '';
export const isValidTimestamp: Rule<string> = (str, msg) => msg && msg('must be a valid timestamp') || tryParseDate(str)?.toISOString() === str;
export const isArrayDistinct: Rule<unknown[]> = (arr, msg) => msg && msg('must have distinct elements') || arr.every((v, index) => arr.indexOf(v) === index);

export const isStringRecord = (obj: unknown): obj is Record<string, unknown> => typeof obj === 'object' && obj !== null && !Array.isArray(obj) && obj.constructor === Object && Object.keys(obj).every(v => typeof v === 'string');
export const tryParseDate = (str: string): Date | undefined => { try { return new Date(str); } catch { /* noop */} };

//

export type Schema<TValue> = {
    parse(input: unknown, name?: string): TValue,
}

export type Builder<TValue> = TValue & Schema<TValue> & {
    default: (value: TValue) => Builder<TValue>,
    optional: () => Builder<TValue | undefined>,
    nullable: () => Builder<TValue | null>,
}

export type NumberBuilder<TValue> = TValue & Schema<TValue> & {
    default: (value: TValue) => NumberBuilder<TValue>,
    optional: () => NumberBuilder<TValue | undefined>,
    nullable: () => NumberBuilder<TValue | null>,
    convertString: () => NumberBuilder<TValue>,
    min: (value: TValue) => NumberBuilder<TValue>,
    max: (value: TValue) => NumberBuilder<TValue>,
}

export type ArrayBuilder<TValueArray> = TValueArray & Schema<TValueArray> & {
    default: (value: TValueArray) => ArrayBuilder<TValueArray>,
    optional: () => ArrayBuilder<TValueArray | undefined>,
    nullable: () => ArrayBuilder<TValueArray | null>,
    distinct: () => ArrayBuilder<TValueArray>,
}

export type Rule<T> = (input: T, msg?: (message: string) => false) => boolean;

// deno-lint-ignore ban-types
export type BasicObject<T> = T extends Function | Array<any> ? never : (T extends object ? T : never);

export type Z = {
    boolean: (...rules: Rule<boolean>[]) => NumberBuilder<boolean>,
    number: (...rules: Rule<number>[]) => NumberBuilder<number>,
    integer: (...rules: Rule<number>[]) => NumberBuilder<number>,
    array: <T>(item: T, ...rules: Rule<T[]>[]) => ArrayBuilder<T[]>,
    string: (...rules: (RegExp | Rule<string>)[]) => Builder<string>,
    timestamp: (...rules: (RegExp | Rule<string>)[]) => Builder<string>,
    record: <K extends string | number | symbol, V>(key: K, value: V, ...rules: Rule<Record<K, V>>[]) => any, // TODO
    object: <T>(type: BasicObject<T>, ...rules: Rule<T>[]) => Builder<T>,
    literal: <T>(value: T, ...rules: Rule<T>[]) => Builder<T>,
    union: <A, B>(lhs: A, rhs: B, ...rules: Rule<A | B>[]) => Builder<A | B>,
}

export const z: Z = {
    boolean: (...rules) => {
        return newBuilder({ schemaType: 'boolean', rules });
    },
    number: (...rules) => {
        return newBuilder({ schemaType: 'number', rules });
    },
    integer: (...rules) => {
        return z.number(...[ Number.isSafeInteger, ...rules ]);
    },
    string: (...rulesOrRegexes) => {
        const rules: Rule<string>[] = rulesOrRegexes.map(v => typeof v === 'function' ? v : p => v.test(p));
        return newBuilder({ schemaType: 'string', rules });
    },
    timestamp: (...rules) => {
        return z.string(...[ isValidTimestamp, ...rules ]);
    },
    array: (arrayItemSchema, ...rules) => {
        return newBuilder({ schemaType: 'array', rules, arrayItemSchema });
    },
    record: (recordKeySchema, recordValueSchema, ...rules) => {
        return newBuilder({ schemaType: 'record', rules, recordKeySchema, recordValueSchema });
    },
    object: (objectSchema, ...rules) => {
        return newBuilder({ schemaType: 'object', rules, objectSchema });
    },
    literal: (literalValue, ...rules) => {
        return newBuilder({ schemaType: 'literal', rules, literalValue });
    },
    union: (lhsSchema, rhsSchema, ...rules) => {
        return newBuilder({ schemaType: 'union', rules, lhsSchema, rhsSchema });
    },
}

//

const stateSymbol = Symbol();

type SchemaType = 'boolean' | 'number' | 'string' | 'array' | 'record' | 'object' | 'literal' | 'union';
type BuilderState<TValue> = {
    schemaType: SchemaType | undefined, rules: Rule<TValue>[], arrayItemSchema?: any, recordKeySchema?: any, recordValueSchema?: any,
    distinct?: boolean, defaultValue?: unknown, convertString?: boolean, minValue?: unknown, maxValue?: unknown, optional?: boolean,
    objectSchema?: any, literalValue?: any, lhsSchema?: any, rhsSchema?: any, nullable?: boolean,
};

function computeLiteralDescription(value: unknown): string {
    return typeof value === 'string' ? `'${value}'`
        : `${value}`;
}

function computeSchemaDescriptionFromObject(obj: Record<string, unknown>): string {
    if (!isStringRecord(obj)) throw new Error(`Unable to compute description for ${obj}`);
    const computeValueType = (obj: unknown): string => Array.isArray(obj) ? 'any[]'
        : isStringRecord(obj) ? computeSchemaDescriptionFromObject(obj)
        : obj === null ? 'null'
        : typeof obj;

    const props: string[] = [];
    for (const [ name, value ] of Object.entries(obj)) {
        props.push(`${name}: ${computeValueType(value)}`);
    }
    return props.length === 0 ? '{}' : `{ ${props.join(', ')} }`;
}

function computeSchemaDescription(schema: any): string {
    const {
        schemaType, arrayItemSchema, recordKeySchema, recordValueSchema,
        optional, nullable, objectSchema, literalValue, lhsSchema, rhsSchema
    } = (schema[stateSymbol] ?? {}) as BuilderState<unknown>;
    const base = schemaType === undefined && isStringRecord(schema) ? computeSchemaDescriptionFromObject(schema)
        : (schemaType === 'boolean' || schemaType === 'number' || schemaType === 'string') ? schemaType
        : schemaType === 'union' ? `${computeSchemaDescription(lhsSchema)} | ${computeSchemaDescription(rhsSchema)}`
        : schemaType === 'array' ? `Array<${computeSchemaDescription(arrayItemSchema)}>`
        : schemaType === 'literal' ? computeLiteralDescription(literalValue)
        : schemaType === 'object' ? computeSchemaDescription(objectSchema)
        : schemaType === 'record' ? `Record<${computeSchemaDescription(recordKeySchema)}, ${computeSchemaDescription(recordValueSchema)}>`
        : undefined;
    if (base === undefined) throw new Error(`TODO implement: ${schemaType}`);
    let rt = base;
    if (nullable) rt = `(${rt} | null)`;
    if (optional) rt += '?';
    return rt;
}

function newBuilder<TValue>(state: BuilderState<TValue>): any {
    const { schemaType } = state;
    const rt = {
        [stateSymbol]: state,
        default: (value: unknown) => {
            state.defaultValue = value;
            return rt;
        },
        optional: () => {
            state.optional = true;
            return rt;
        },
        nullable: () => {
            state.nullable = true;
            return rt;
        },
        convertString: () => {
            if (schemaType !== 'number') throw new Error();
            state.convertString = true;
            return rt;
        },
        min: (value: unknown) => {
            if (schemaType !== 'number') throw new Error();
            state.minValue = value;
            return rt;
        },
        max: (value: unknown) => {
            if (schemaType !== 'number') throw new Error();
            state.maxValue = value;
            return rt;
        },
        distinct: () => {
            if (schemaType !== 'array') throw new Error();
            state.distinct = true;
            return rt;
        },
        parse: (input: unknown, name?: string) => {
            const path: (string | number)[] = [ name ?? 'input' ];

            const applySchema = (input: unknown, schema: any, fail: (path: (string | number)[], value: unknown, message?: string) => void) => {
                const {
                    schemaType, rules, arrayItemSchema, convertString, distinct, recordKeySchema, recordValueSchema,
                    defaultValue, minValue, maxValue, optional, objectSchema, literalValue, lhsSchema, rhsSchema,
                    nullable
                } = (schema[stateSymbol] ?? {}) as BuilderState<unknown>;
                const checkRules = (value: unknown) => {
                    let allRules = rules;
                    if (minValue !== undefined || maxValue !== undefined) allRules = [ ...allRules ];
                    if (minValue !== undefined) allRules.unshift(v => v as any >= (minValue as any));
                    if (maxValue !== undefined) allRules.unshift(v => v as any <= (maxValue as any));
                    for (const rule of allRules) {
                        const result = rule(value);
                        if (result === false || typeof result === 'string') return fail(path, value, typeof result === 'string' ? result : undefined);
                    }
                }
                if (optional && input === undefined) return;
                if (nullable && input === null) return;
                if (schemaType === undefined || schemaType === 'object') {
                    if (!isStringRecord(input)) throw new Error(`Bad ${path.join('.')}: expected object`);
                    for (const [ propName, propDef ] of Object.entries(objectSchema ?? schema)) {
                        const propValue = input[propName];
                        path.push(propName);
                        const converted = applySchema(propValue, propDef, fail);
                        if (converted !== undefined) {
                            input[propName] = converted;
                        }
                        if (input[propName] === undefined) delete input[propName];
                        path.pop();
                    }
                    checkRules(input);
                } else if (schemaType === 'number') {
                    let value: number;
                    if (typeof input === 'number') {
                        value = input;
                    } else if (input === undefined && typeof defaultValue === 'number') {
                        value = defaultValue;
                    } else if (typeof input === 'string' && convertString) {
                        const converted = Number(input);
                        if (Number.isNaN(converted)) return fail(path, input, 'unable to convert to number');
                        value = converted;
                    } else {
                        return fail(path, input, 'expected number');
                    }
                    checkRules(value);
                    if (value !== input) return value;
                } else if (schemaType === 'string') {
                    let value: string;
                    if (typeof input === 'string') {
                        value = input;
                    } else if (input === undefined && typeof defaultValue === 'string') {
                        value = defaultValue;
                    } else {
                        return fail(path, input, 'expected string');
                    }
                    checkRules(value);
                    if (value !== input) return value;
                } else if (schemaType === 'array') {
                    if (!arrayItemSchema) throw new Error();
                    if (!Array.isArray(input)) return fail(path, input, 'expected array');
                    for (let i = 0; i < input.length; i++) {
                        path.push(i);
                        const converted = applySchema(input[i], arrayItemSchema, fail);
                        if (converted !== undefined) {
                            input[i] = converted;
                        }
                        path.pop();
                    }
                    checkRules(input);
                    if (distinct && !isArrayDistinct(input)) return Array.from(new Set(input));
                } else if (schemaType === 'record') {
                    if (!recordKeySchema || !recordValueSchema) throw new Error();
                    const { schemaType: keySchemaType } = recordKeySchema[stateSymbol] ?? {} as BuilderState<unknown>;
                    if (keySchemaType !== 'string') return fail(path, input, 'only string-keyed objects are supported');
                    if (!isStringRecord(input)) return fail(path, input, 'expected object');
                    for (const [ inputKey, inputValue ] of Object.entries(input)) {
                        applySchema(inputKey, recordKeySchema, fail);
                        path.push(inputKey);
                        applySchema(inputValue, recordValueSchema, fail);
                        if (inputValue === undefined) delete input[inputKey];
                        path.pop();
                    }
                    checkRules(input);
                } else if (schemaType === 'literal') {
                    if (!literalValue) throw new Error();
                    if (input !== literalValue) return fail(path, input, 'unexpected literal value');
                    checkRules(input);
                } else if (schemaType === 'boolean') {
                    if (typeof input !== 'boolean') return fail(path, input, 'expected boolean');
                    checkRules(input);
                } else if (schemaType === 'union') {
                    if (!lhsSchema || !rhsSchema) throw new Error();
                    let failed = false;
                    applySchema(input, lhsSchema, () => failed = true);
                    if (failed) {
                        failed = false;
                        applySchema(input, rhsSchema, () => failed = true);
                        if (failed) return fail(path, input, `expected ${computeSchemaDescription(lhsSchema)} | ${computeSchemaDescription(rhsSchema)}`);
                    }
                    checkRules(input);
                } else {
                    throw new Error();
                }
            };
            applySchema(input, rt, (path, value, message) => { throw new Error(`Bad ${path.join('.')}: ${value}${message ? `, ${message}` : ''}`); });
            return input;
        },
        toString: () => {
            return computeSchemaDescription(rt);
        },
    }
    return rt;
}
