# Third-Party Notices

Velloo bundles and/or redistributes the third-party open-source software
listed below. Each component is the property of its respective copyright
holders and is used under the terms of its own license.

> This file lists the directly redistributed components. Before each public
> release it should be regenerated from the full dependency tree (e.g. with a
> license-collection tool) so every transitively bundled package is covered.

The most directly redistributed surfaces are:

- `packages/shadcn-snapshot` — a pinned snapshot of shadcn/ui components,
  embedded in the binary and emitted into user projects.
- The framework providers (`@velloo/provider-*`) and adapters, which build on
  the upstream component libraries below.
- The published CLI bundle (`dist/cli.js` + `dist/chunk-*.js` + the canvas SPA),
  which inlines its pure-JS runtime dependencies rather than installing them
  from npm.
- Bun 1.4.2, installed from exact official `@oven/bun-*` platform packages for
  npm users and copied unmodified into the standalone direct-install archives.
  Its complete upstream linked-library notice ships as `BUN-LICENSE.md`.

## Components

| Component | License | Copyright | Source |
|---|---|---|---|
| Poppins Bold (`packages/canvas/public/fonts/poppins-700.woff2`) | SIL Open Font License 1.1 (full text alongside the font) | © 2020 The Poppins Project Authors | https://github.com/itfoundry/Poppins |
| Bun 1.4.2 runtime and embedded libraries | MIT; LGPL-2.0 and additional terms detailed in `BUN-LICENSE.md` | Bun and upstream library contributors | https://github.com/oven-sh/bun/tree/bun-v1.4.2 |
| shadcn/ui | MIT | © 2023 shadcn | https://github.com/shadcn-ui/ui |
| Radix UI (`@radix-ui/*`) | MIT | © 2022 WorkOS | https://github.com/radix-ui/primitives |
| Lucide (`lucide` / `lucide-react`) | ISC | © 2022 Lucide Contributors (portions from Feather, MIT, © 2013–2017 Cole Bemis) | https://github.com/lucide-icons/lucide |
| Tailwind CSS | MIT | © Tailwind Labs, Inc. | https://github.com/tailwindlabs/tailwindcss |
| MUI (`@mui/material`) | MIT | © 2014 Call-Em-All | https://github.com/mui/material-ui |
| Emotion (`@emotion/*`) | MIT | © Emotion team and other contributors | https://github.com/emotion-js/emotion |
| React / React DOM | MIT | © Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| Ant Design (`antd`, `@ant-design/*`, `rc-*`) | MIT | © Ant Design contributors | https://github.com/ant-design/ant-design |
| Chakra UI v2 | MIT | © 2019 Segun Adebayo | https://github.com/chakra-ui/chakra-ui |
| Framer Motion | MIT | © 2018 Framer B.V. | https://github.com/motiondivision/motion |
| Apache ECharts | Apache-2.0 | © The Apache Software Foundation | https://github.com/apache/echarts |
| React DayPicker (`react-day-picker`) | MIT | © Giampaolo Bellavite | https://github.com/gpbl/react-day-picker |
| Embla Carousel (`embla-carousel`, `embla-carousel-react`) | MIT | © David Jerleke | https://github.com/davidjerleke/embla-carousel |
| tw-animate-css | MIT | © Luca Bosin | https://github.com/Wombosvideo/tw-animate-css |
| Zod | MIT | © 2020 Colin McDonnell | https://github.com/colinhacks/zod |
| Hono | MIT | © 2021-present Yusuke Wada | https://github.com/honojs/hono |
| MCP TypeScript SDK | MIT | © 2024 Anthropic, PBC | https://github.com/modelcontextprotocol/typescript-sdk |
| culori | MIT | © Dan Burzo | https://github.com/Evercoder/culori |
| jsdiff (`diff`) | BSD-3-Clause | © 2009-2015 Kevin Decker | https://github.com/kpdecker/jsdiff |
| sonner | MIT | © 2023 Emil Kowalski | https://github.com/emilkowalski/sonner |
| class-variance-authority | Apache-2.0 | © Joe Bell | https://github.com/joe-bell/cva |
| clsx | MIT | © Luke Edwards | https://github.com/lukeed/clsx |
| tailwind-merge | MIT | © Dany Castillo | https://github.com/dcastil/tailwind-merge |
| pixelmatch | ISC | © 2019 Mapbox | https://github.com/mapbox/pixelmatch |
| pngjs | MIT | © pngjs contributors | https://github.com/pngjs/pngjs |
| zustand | MIT | © 2019 Paul Henschel | https://github.com/pmndrs/zustand |
| citty | MIT | © Pooya Parsa (unjs) | https://github.com/unjs/citty |
| @clack/prompts | MIT | © Nate Moore | https://github.com/bombshell-dev/clack |
| picocolors | ISC | © 2021 Alexey Raspopov | https://github.com/alexeyraspopov/picocolors |
| @cloudflare/blindrsa-ts | Apache-2.0 | © Cloudflare, Inc. | https://github.com/cloudflare/blindrsa-ts |

## License texts

Poppins is distributed under the SIL Open Font License 1.1; its copyright
notice and full license text ship beside the font as
`packages/canvas/public/fonts/OFL-1.1.txt` and are copied into release
artifacts with the canvas. Except for Poppins and Bun's separately documented
linked libraries, the components above are distributed under the MIT, ISC,
BSD-3-Clause, or Apache-2.0 license. The full texts follow; the copyright line
of each applies as listed in the table. The complete Bun 1.4.2 upstream notice
and relinking information is provided in `BUN-LICENSE.md`. (The Apache-2.0
text also ships as this package's own LICENSE file.)

### MIT License

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC License

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### BSD-3-Clause License

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Apache License 2.0

Applies to Apache ECharts, class-variance-authority, and
`@cloudflare/blindrsa-ts`. The full text is the same as this package's own
`LICENSE` file (Apache License, Version 2.0, January 2004,
http://www.apache.org/licenses/LICENSE-2.0).
