module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // The logo's colours, same scale as the till so both read as one product.
      colors: {
        navy: { 50:'#eef4fa',100:'#d6e4f1',200:'#adc8e3',300:'#7ea6cf',400:'#4f80b5',500:'#2f6299',600:'#1f4c7d',700:'#173f69',800:'#12385f',900:'#0d2a48',950:'#081a2e' },
        teal: { 50:'#ecfbfb',100:'#cdf3f3',200:'#9fe6e6',300:'#67d2d3',400:'#31b8ba',500:'#12aeb1',600:'#0e9da0',700:'#0c7f82',800:'#0f6567',900:'#115356',950:'#043438' },
        lime: { 50:'#f5fbea',100:'#e8f5d0',200:'#d2eba6',300:'#b5dc72',400:'#9ccd4c',500:'#8bc53f',600:'#6ba12b',700:'#527b24',800:'#436222',900:'#3a5321',950:'#1d2e0d' },
      },
    },
  },
  plugins: [],
};
