// Mode démo (développement seulement) : l'espace équipe avec des données d'exemple, sans
// compte ni base, pour travailler l'interface sur grand et petit écran.
//   npm run dev:equipe   puis   http://localhost:5174/?demo
// Jamais inclus dans la version en ligne (voir main.tsx). Les filtres sont ignorés et les
// écritures ne font rien : seul l'affichage compte ici.

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMO_SESSION, rpcResult, tableRows } from './fixtures';

interface Result {
  data: unknown;
  error: null;
  count?: number;
}

class DemoQuery implements PromiseLike<Result> {
  private head = false;
  private single = false;
  private start = 0;
  private end = Infinity;

  constructor(private readonly table: string) {}

  select(_columns?: string, options?: { head?: boolean }) {
    this.head = options?.head ?? false;
    return this;
  }
  range(from: number, to: number) {
    this.start = from;
    this.end = to;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  order() {
    return this;
  }
  insert() {
    return this;
  }
  update() {
    return this;
  }

  then<A = Result, B = never>(
    resolve?: ((value: Result) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const rows = tableRows(this.table).slice(this.start, this.end + 1);
    const result: Result = this.head
      ? { data: null, error: null, count: rows.length }
      : this.single
        ? { data: rows[0] ?? null, error: null }
        : { data: rows, error: null, count: rows.length };
    // Un petit délai, comme un vrai réseau : on voit les états « Chargement… ».
    return new Promise<Result>((r) => setTimeout(() => r(result), 150)).then(resolve, reject);
  }
}

export function createDemoClient(): SupabaseClient {
  const client = {
    from: (table: string) => new DemoQuery(table),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      await new Promise((r) => setTimeout(r, 150));
      return { data: rpcResult(name, args), error: null };
    },
    auth: {
      getSession: async () => ({ data: { session: DEMO_SESSION } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => {
        sessionStorage.removeItem('murya-demo');
        location.href = '/';
      },
      signInWithPassword: async () => ({ error: null }),
    },
  };
  return client as unknown as SupabaseClient;
}
