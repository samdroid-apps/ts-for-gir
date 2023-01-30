<p align="center">
  <img  src=".github/ts-for-gir.png" />
  <h1 align="center">TS <small>for</small> GIR</h1>
</p>

<p align="center">
  <img src="https://badgen.net/github/checks/gjsify/ts-for-gir" />
  <img src="https://badgen.net/github/license/gjsify/ts-for-gir" />
  <img src="https://badgen.net/npm/v/@ts-for-gir/cli" />
  <img src="https://badgen.net/npm/dw/@ts-for-gir/cli" />
</p>

<p align="center">TypeScript type definition generator for GObject introspection interfaces</p>


`ts-for-gir` is a robust [TypeScript](https://www.typescriptlang.org/) type definitions generator that improves the development experience of [GJS](https://wiki.gnome.org/Projects/Gjs) projects. It has been completely rewritten over time to provide a more complete and accurate TypeScript representation of the [GObject
introspection](https://wiki.gnome.org/Projects/GObjectIntrospection) interfaces. With `ts-for-gir`, developers can now benefit from TypeScript's strong typing and improved code navigation, making it easier to build robust and powerful applications with GJS.

## Getting Started

Install the latest LTS version of Node.js. We recommend using [NVM](https://github.com/nvm-sh/nvm) for this purpose. After Node.js has been installed, `ts-for-gir` can be executed with the following command:

```
npx @ts-for-gir/cli --help
```

That's it, you can start generating your types 👩‍💻.

> Alternatively, you can also install ts-for-gir globally, then you only need the `ts-for-gir` command.

>For more advanced examples, take a look in our [examples](/examples/) directory. Here you will find different examples using different bundlers.

## CLI

To generate the Typescript type definitions of Gtk-4.0 for Gjs run

```
ts-for-gir generate Gtk-4.0 -e gjs
```

To generate this types for node-gtk run 

```
ts-for-gir generate Gtk-4.0 -e node
```
You can also look at the [examples](/examples/) to see how the types are generated there and at the [CLI Package](/packages/cli) for the full CLI documentation.

## tsconfig.json
It's recommended that you create or modify your `tsconfig.json`/`jsconfig.json`, so it doesn't include the `DOM` lib, as it conflicts with some generated GJS global types and will cause lint warnings and compilation errors with typescript.

Either add/edit the `lib` property so it doesn't include `"DOM"`, or enable the property `noLib` (However the side effects of doing this should be considered). For more information check the documentation for both the [`lib`](https://www.typescriptlang.org/tsconfig/#lib) and [`noLib`](https://www.typescriptlang.org/tsconfig#noLib) properties.


## Examples

We have ported some examples from Gjs and node-gtk to typescript but also created our own. You can find a more detailed description of the examples in the [./examples/](/examples/) subfolder.

## What it's like

![screencast](screencast-01.gif)

## Development

Install GObject Introspection Repository files:

```bash
# Ubuntu 22.04
sudo apt update && sudo apt install \
    libappindicator3-dev \
    libgda-5.0-dev \
    libgirepository1.0-dev \
    libgtk-3-dev \
    libgtk-4-dev \
    libgtksourceview-3.0-dev \
    libnotify-dev \
    libsoup2.4-dev \
    libsoup-3.0-dev \
    libwebkit2gtk-4.0-dev \
    libadwaita-1-dev \
    # The following are for GNOME Shell types
    gnome-shell-common \
    libmutter-10-dev \
    libgcr-3-dev \
    libgnome-desktop-3-dev # GnomeDesktop-3.0.gir

# Fedora 37
sudo dnf update && sudo dnf install \
    libappindicator-gtk3-devel \
    libgda-devel \
    gobject-introspection-devel \
    gtk3-devel \
    gtk4-devel \
    libsoup3-devel \
    gtksourceview3-devel \
    libnotify-devel \
    libsoup-devel \
    webkit2gtk3-devel \
    libadwaita-devel \
    # The following are for GNOME Shell types
    gnome-shell \
    gcr-devel \
    gnome-desktop3-devel # GnomeDesktop-3.0.gir
```

Checkout this repository, install the dependencies and build:

```bash
git clone https://github.com/gjsify/ts-for-gjs
cd ts-for-gjs
git submodule update --init
yarn install
yarn run build
```

Generate example type definitions:

```bash
yarn run regress
```
### Gir XML Format

See [gobject-introspection/docs/gir-1.2.rnc](https://gitlab.gnome.org/GNOME/gobject-introspection/-/blob/master/docs/gir-1.2.rnc) for type definitions.

### Debugging

It is strongly recommended to use the debugger. For Visual Studio Code there are some predefined launch configurations for it. Take a look at the following video:

https://user-images.githubusercontent.com/1073989/150143112-1c0a2dab-3d4c-4472-818f-8404a620cc53.mp4

### yarn Scripts

#### Validate

To validate all your generated type definition files in this project run 

```bash
yarn run validate:types:all
```

To validate only your type definition files for Gjs

```bash
yarn run validate:types:gjs
```

To validate only your type definition files for node-gtk

```bash
yarn run validate:types:node
```

You can also validate a single type definition file like this

```bash
yarn run validate -- ./@types/Gjs/GObject-2.0.d.ts
```


### Test

#### Test gir files

We have a test which tries to generate the type definition files for all gir files from the [vala-girs](https://github.com/nemequ/vala-girs) repository.

Before you can run this test you need to checkout the vala-girs submodule, to do that run this in the root of ts-for-gjs:

```bash
git submodule update --init
```

Now you can run the test with

```bash
yarn run test:girs:gjs
yarn run test:girs:node
# or yarn run test:girs:all
```

## FAQ

Problem: I get the following error:

```
FATAL ERROR: Scavenger: semi-space copy Allocation failed - JavaScript heap out of memory
```

Solution:

```bash
sudo sysctl -w vm.max_map_count=262144
NODE_OPTIONS=--max-old-space-size=25600 yarn run ...
```


## Related Projects

### TypeScript Type Definitions

* [gnome-gtk](https://github.com/codejamninja/gnome-gtk) - Typescript bindings for gnome gtk
* [ts-gir](https://github.com/codejamninja/ts-gir) - Typescript bindings for GJS
* [node-gir-typedef](https://github.com/SolarLiner/node-gir-typedef) - TypeScript bindings for node-gir
* [gir2dts](https://github.com/darkoverlordofdata/gir2dts) - The project this is inspired by
* [gir-dts-generator](https://github.com/Place1/gir-dts-generator) - The project that inspired this project
* [gjs-ts](https://github.com/niagr/gjs-ts) - Typescript bindings for GJS
* [Typescript Doclet](https://github.com/gjsify/doclet) - Experimental TypeScript binding generator written in Vala as a Valadoc extension
* [gi.ts](https://gitlab.gnome.org/ewlsh/gi.ts) - Highly accurate TypeScript bindings for GJS
* [gi-ts](https://github.com/gi-ts) TypeScript Type definitions for the GNOME base stack (e.g. GLib, GObject) 

### Other

* [gjs-docs](https://github.com/apla/gjs-docs) - GJS documentation server written using gjs
* [node-gtk](https://github.com/romgrk/node-gtk) - GIO bindings for NodeJS
* [cgjs](https://github.com/cgjs/cgjs) - A NodeJS / CommonJS Runtime for GJS
* [jsgtk](https://github.com/WebReflection/jsgtk) - Replaced by cgjs
* [vala-girs](https://github.com/nemequ/vala-girs) - Collection of GIRs and VAPIs for the Vala toolchain
* [gjs-examples](https://github.com/optimisme/gjs-examples) - GJS examples showing how to build Gtk javascript applications
* [hello-gjs-yarn](https://github.com/jo/hello-gjs-yarn) - Gjs example using Babel and Rollup
* [vala-object](https://github.com/antono/vala-object) - Set of examples of how you can build native code with Vala and use it in Gjs, Node.js and other environments
