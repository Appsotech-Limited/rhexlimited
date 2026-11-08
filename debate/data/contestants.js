/*
 * RHEX Reality Debate Show (The President): settings and contestant list.
 *
 * To add a contestant, copy one block inside `contestants` and change it.
 *   number : the contestant's number. Their share link is contestant.html?c=<number>
 *   name   : full name as it should appear on the page
 *   photo  : optional, path to a portrait (e.g. "assets/contestants/1120.jpg").
 *            Leave "" to show a gold monogram instead.
 *   message: optional, the contestant's appeal to voters (one string per paragraph)
 */
window.RHEX_DEBATE = {
  config: {
    showTitle: "RHEX Reality Debate Show",
    showSubtitle: "The President",

    // Paystack PUBLIC key (starts with pk_live_ or pk_test_). Never put the secret key here.
    paystackPublicKey: "pk_test_REPLACE_WITH_YOUR_PAYSTACK_PUBLIC_KEY",

    currency: "NGN",
    votePrice: 100,              // naira per vote
    voteBundles: [1, 5, 10, 20], // quick picks on the vote panel
    maxVotesPerPayment: 10000,

    // Live vote counts come from the Netlify function in netlify/functions/debate-tally.mjs.
    // Leave as is; set to "" to switch the counts off on the pages entirely.
    tallyEndpoint: "/api/debate/tally",
    tallyRefreshSeconds: 30
  },

  contestants: [
    {
      number: "1120",
      name: "Splendour Ogbabede",
      photo: "",
      message: [
        "Please, I need your votes to remain and win in the RHEX Reality Debate Show (The President).",
        "You can cast multiple votes at the same time. Please help me win.",
        "Thank you so much for your votes and support."
      ]
    }
  ]
};
