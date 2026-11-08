/*
 * RHEX Reality Debate Show (The President): settings and contestant list.
 *
 * To add a contestant, copy one block inside `contestants` and change it.
 *   number : the contestant's number. Their share link is contestant.html?c=<number>
 *   name   : full name as it should appear on the page
 *   photo  : optional, path to a portrait, 4:5 (e.g. "assets/contestants/1120.jpg").
 *            Leave "" to show a gold monogram instead.
 *   poster : optional, the official square poster, used as the WhatsApp/Facebook link preview
 *   message: optional, the contestant's appeal to voters (one string per paragraph).
 *            Leave it out to use defaultMessage below.
 */
window.RHEX_DEBATE = {
  config: {
    showTitle: "RHEX Reality Debate Show",
    showSubtitle: "The President",

    // Paystack PUBLIC key (starts with pk_live_ or pk_test_). Never put the secret key here.
    paystackPublicKey: "pk_live_69f5a44a796e68c35b677ef61fd98b7f572df538",

    currency: "NGN",
    votePrice: 100,              // naira per vote
    voteBundles: [1, 5, 10, 20], // quick picks on the vote panel
    maxVotesPerPayment: 10000,

    // Live vote counts come from the Netlify function in netlify/functions/debate-tally.mjs.
    // Leave as is; set to "" to switch the counts off on the pages entirely.
    tallyEndpoint: "/api/debate/tally",
    tallyRefreshSeconds: 30,

    // Appeal shown on a contestant's page when they don't have their own `message`.
    defaultMessage: [
      "Please, I need your votes to remain and win in the RHEX Reality Debate Show (The President).",
      "You can cast multiple votes at the same time. Please help me win.",
      "Thank you so much for your votes and support."
    ]
  },

  // Imported from selar.com/rhexcontestant1111 to rhexcontestant1128 on 2026-11-08.
  contestants: [
    { number: "1111", name: "Blessing Ajayi", photo: "assets/contestants/1111.jpg", poster: "assets/contestants/1111-poster.jpg" },
    { number: "1112", name: "Ikedichukwu Eze", photo: "assets/contestants/1112.jpg", poster: "assets/contestants/1112-poster.jpg" },
    { number: "1113", name: "Titoluwani Coker", photo: "assets/contestants/1113.jpg", poster: "assets/contestants/1113-poster.jpg" },
    { number: "1114", name: "Karen Olajuyin", photo: "assets/contestants/1114.jpg", poster: "assets/contestants/1114-poster.jpg" },
    { number: "1115", name: "Miracle Ibrahim", photo: "assets/contestants/1115.jpg", poster: "assets/contestants/1115-poster.jpg" },
    { number: "1116", name: "Delpina Andrew", photo: "assets/contestants/1116.jpg", poster: "assets/contestants/1116-poster.jpg" },
    // Selar poster shows the wrong name, so no poster preview
    { number: "1117", name: "Hilary Solomon", photo: "assets/contestants/1117.jpg" },
    { number: "1118", name: "Daniella Adejo", photo: "assets/contestants/1118.jpg", poster: "assets/contestants/1118-poster.jpg" },
    { number: "1119", name: "Doxa Oyetunde", photo: "assets/contestants/1119.jpg", poster: "assets/contestants/1119-poster.jpg" },
    { number: "1120", name: "Splendour Ogbabede", photo: "assets/contestants/1120.jpg", poster: "assets/contestants/1120-poster.jpg" },
    { number: "1121", name: "Cyril Ojonugwa Fidelis", photo: "assets/contestants/1121.jpg", poster: "assets/contestants/1121-poster.jpg" },
    { number: "1122", name: "Hyelsintha Isaac Ndahi", photo: "assets/contestants/1122.jpg", poster: "assets/contestants/1122-poster.jpg" },
    { number: "1123", name: "Nwata Splendour Ugonna", photo: "assets/contestants/1123.jpg", poster: "assets/contestants/1123-poster.jpg" },
    { number: "1124", name: "Aliyu Marwan Adamu", photo: "assets/contestants/1124.jpg", poster: "assets/contestants/1124-poster.jpg" },
    { number: "1125", name: "Godwin Dove Unimanye", photo: "assets/contestants/1125.jpg", poster: "assets/contestants/1125-poster.jpg" },
    { number: "1126", name: "Idzi Kerren", photo: "assets/contestants/1126.jpg", poster: "assets/contestants/1126-poster.jpg" },
    { number: "1127", name: "Hauwa Abubakar", photo: "assets/contestants/1127.jpg", poster: "assets/contestants/1127-poster.jpg" },
    { number: "1128", name: "Ushie Brian", photo: "assets/contestants/1128.jpg", poster: "assets/contestants/1128-poster.jpg" }
  ]
};
