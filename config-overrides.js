const path = require('path');
const WorkerPlugin = require('worker-plugin');

// smartcube-web-bluetooth ships ES2020 (?., ??, catch {}), which webpack 4's parser
// can't read, so compile it down before anything else sees it. It is an .mjs file
// importing CommonJS packages (aes-js) by name, which webpack 4 allows only if it
// treats the file as ordinary JavaScript.
const smartcubeRule = {
    test: /\.m?js$/,
    include: path.resolve(__dirname, 'node_modules/smartcube-web-bluetooth'),
    type: 'javascript/auto',
    loader: require.resolve('babel-loader'),
    options: {
        babelrc: false,
        configFile: false,
        compact: false,
        sourceType: 'module',
        plugins: [
            '@babel/plugin-proposal-optional-chaining',
            '@babel/plugin-proposal-nullish-coalescing-operator',
            '@babel/plugin-proposal-optional-catch-binding',
            '@babel/plugin-proposal-logical-assignment-operators',
            '@babel/plugin-proposal-numeric-separator',
            '@babel/plugin-proposal-class-properties',
        ].map(p => require.resolve(p)),
    },
};

module.exports = {
    webpack: function (config, env) {
        // ...add your webpack config
        config.plugins.push(
            new WorkerPlugin()
        )
        const oneOf = config.module.rules.find(rule => rule.oneOf).oneOf;
        oneOf.unshift(smartcubeRule);
        return config;
    }
}
