import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import peerDepsExternal from 'rollup-plugin-peer-deps-external'
import dts from 'rollup-plugin-dts'
import terser from '@rollup/plugin-terser'

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.cjs.js',
        format: 'cjs',
        sourcemap: true,
        banner: "'use client';",
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
        banner: "'use client';",
      },
    ],
    plugins: [
      peerDepsExternal(),
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.build.json' }),
    ],
    external: ['react', 'react-dom', 'next/navigation'],
  },
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [dts()],
    external: ['react', 'react-dom', 'next/navigation'],
  },
  // React Native entry point
  {
    input: 'src/react-native/index.ts',
    output: [
      {
        file: 'dist/react-native.cjs.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/react-native.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      peerDepsExternal(),
      resolve(),
      commonjs(),
      typescript({ tsconfig: './tsconfig.build.json' }),
    ],
    external: [
      'react',
      'react-native',
      '@react-native-async-storage/async-storage',
    ],
  },
  {
    input: 'src/react-native/index.ts',
    output: [{ file: 'dist/react-native.d.ts', format: 'esm' }],
    plugins: [dts()],
    external: ['react', 'react-native', '@react-native-async-storage/async-storage'],
  },
  {
    input: 'src/browser.ts',
    output: {
      file: 'dist/n.min.js',
      format: 'iife',
      name: 'NohmoScript',
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.build.json' }),
      terser(),
    ],
  },
]
