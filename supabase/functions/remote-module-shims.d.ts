declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
}

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export function createClient(url: string, key: string): any;
}

declare module "https://esm.sh/xlsx@0.18.5" {
  export const utils: {
    book_new(): any;
    book_append_sheet(workbook: any, worksheet: any, name: string): void;
  };
  export function write(workbook: any, options: { bookType: string; type: string }): Uint8Array;
}