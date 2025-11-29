import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.13';
import { isNotEmpty, z } from './z.ts';

Deno.test('parse', () => {
    const Type1 = z.object<{ str1: string }>({
        str1: z.string(),
    });
    assertEquals(Type1.parse({ str1: 'd' }), { str1: 'd' });

    assertThrows(() => Type1.parse({ str1: 1 }), Error, 'Bad input');
    assertThrows(() => Type1.parse({ }), Error, 'Bad input');
    assertThrows(() => Type1.parse({ }), Error, 'Bad input');
    assertThrows(() => z.object<{ str1: string }>({ str1: z.string(isNotEmpty) }).parse({ str1: '' }), Error, 'Bad input');

    const Type2 = z.object<{ str1: string }>({
        str1: z.string().default('val1'),
    });
    assertEquals(Type2.parse({ }), { str1: 'val1' });
    assertEquals(Type2.parse({ str1: 'val2' }), { str1: 'val2' });

    assertEquals(z.object<{ arr1: string[] }>({ arr1: z.array(z.string()).distinct() }).parse({ arr1: [ 'a', 'b', 'c', 'a' ] }), { arr1: [ 'a', 'b', 'c' ] });
    assertThrows(() => z.object<{ int1: number }>({ int1: z.number() }).parse({ int1: '1' }));
    assertThrows(() => z.object<{ int1: number }>({ int1: z.integer() }).parse({ int1: 1.2 }));
    assertThrows(() => z.object<{ int1: number }>({ int1: z.integer().min(1) }).parse({ int1: 0 }), Error, 'at least 1');
    assertThrows(() => z.object<{ int1: number }>({ int1: z.integer().max(1) }).parse({ int1: 2 }), Error, 'at most 1');
    assertEquals(z.object<{ int1: number }>({ int1: z.number().convertString() }).parse({ int1: '1' }), { int1: 1 });
    assertEquals(z.object<{ int1: number }>({ int1: z.integer().min(1).max(1) }).parse({ int1: 1 }), { int1: 1 });
    assertEquals(z.object<{ int1?: number }>({ int1: z.integer().optional() }).parse({ int1: undefined }), { });
    assertEquals(z.object<{ int1?: number }>({ int1: z.integer().optional() }).parse({ }), { });
    assertEquals(z.object({ }).parse({ }), { });

    const Type4 = z.object<{ rec1: Record<string, string> }>({
        rec1: z.record(z.string(/^[a-z]$/), z.string()),
    });
    assertEquals(Type4.parse({ rec1: { } }), { rec1: { } });
    assertEquals(Type4.parse({ rec1: { a: 'b' } }), { rec1: { a: 'b' } });
    assertThrows(() => Type4.parse({ rec1: { foo: 'bar' } }));

    assertEquals(z.literal('a').parse('a'), 'a');
    assertThrows(() => z.literal('a').parse('b'), Error, 'Bad input');
    assertEquals(z.boolean().parse(true), true);
    assertEquals(z.boolean().parse(false), false);
    assertThrows(() => z.boolean().parse('true'), Error, 'Bad input');

    assertEquals(z.union(z.literal('a'), z.literal('b')).parse('a'), 'a');
    assertEquals(z.union(z.literal('a'), z.literal('b')).parse('b'), 'b');
    assertThrows(() => z.union(z.literal('b'), z.literal('b')).parse('c'));

    assertEquals(z.string().nullable().parse(null), null);
    assertThrows(() => z.string().parse(null));

    assertEquals(z.record(z.string(), z.string()).optional().parse(undefined), undefined);
});

Deno.test('toString', () => {
    const input = new Map<object, string>([
        [ z.union(z.string(), z.number()), 'string | number' ],
        [ z.union(z.literal(2), z.literal(3)), '2 | 3' ],
        [ z.literal('e'), `'e'` ],
        [ z.boolean(), `boolean` ],
        [ z.number(), `number` ],
        [ z.string(), `string` ],
        [ z.integer(), `number` ],
        [ z.timestamp(), `string` ],
        [ z.array(z.string()), `Array<string>` ],
        [ z.record(z.string(), z.integer()), `Record<string, number>` ],
        [ z.number().optional(), `number?` ],
        [ z.number().nullable(), `(number | null)` ],
        [ z.object({}), `{}` ],
        [ z.object({ num1: 2, str1: 'a', arr1: [], rec1: { a: 'b' } }), `{ num1: number, str1: string, arr1: any[], rec1: { a: string } }` ],
    ]);
    for (const [ schema, expected ] of input) {
        const actual = schema.toString();
        assertEquals(actual, expected, `expected: ${expected}, actual: ${actual}`);
    }
});

// below should fail to typecheck
// z.object(() => {});
// z.object(null);
// z.object([]);
// z.object(2);
// z.object(undefined);
z.object(new URL('https://example/asdf')); // impossible to exclude class instances, typescript is duck-typed