module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.nohmo.NohmoPackage;',
        packageInstance: 'new NohmoPackage()',
      },
      ios: {
        podspecPath: './Nohmo.podspec',
      },
    },
  },
};
