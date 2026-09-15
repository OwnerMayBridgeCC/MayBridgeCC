export function transfersReady(account) {
  return account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active';
}

export async function syncConnect(database, stripe, accountId) {
  const account = await stripe.v2.core.accounts.retrieve(accountId, {include:['configuration.recipient']});
  const ready = transfersReady(account);
  await database.query('UPDATE provider_profiles SET payments_enabled=$2,stripe_onboarding_complete=$2 WHERE stripe_account_id=$1', [accountId,ready]);
  return {ready,account};
}

export async function onboardingLink(stripe, accountId, baseUrl) {
  return stripe.v2.core.accountLinks.create({account:accountId,use_case:{type:'account_onboarding',account_onboarding:{configurations:['recipient'],refresh_url:baseUrl+'/portal?connect=refresh',return_url:baseUrl+'/portal?connect=return'}}});
}
