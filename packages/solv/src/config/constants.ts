// WEBSITE URL
export const WEB_VALIDATORS_DAO = 'https://dao.validators.solutions'
export const WEB_VALIDATORS_SOLUTIONS = 'https://validators.solutions'

// solv config Path
export const SOLV_CONFIG_PATH = '~/solv.config.json'
export const SOLV_CONFIG_FILE = 'solv.config.json'
export const SOLV4_CONFIG_FILE = 'solv4.config.json'

// Linux System Config Files
export const SOL_SERVICE = '/etc/systemd/system/solv.service'
export const SOL_LOGROTATE = '/etc/logrotate.d/solana'
export const SOL_SYSTEM_CONFIG21 = '/etc/sysctl.d/21-solana-validator.conf'
export const SOL_NOFILES_CONF = '/etc/security/limits.d/90-solana-nofiles.conf'
export const SOL_SYSTEM_CONF = '/etc/systemd/system.conf'
export const SOLANA_PATH = '/home/solv/.local/share/solana/install'

// Solana Key Names
export const IDENTITY_KEY = 'identity.json'
export const UNSTAKED_KEY = 'unstaked-identity.json'
export const RELAYER_KEY = 'relayer-keypair.json'
export const MAINNET_VALIDATOR_KEY = 'mainnet-validator-keypair.json'
export const MAINNET_VALIDATOR_VOTE_KEY = 'mainnet-vote-account-keypair.json'
export const MAINNET_VALITATOR_AUTHORITY_KEY = 'mainnet-authority-keypair.json'
export const TESTNET_VALIDATOR_KEY = 'testnet-validator-keypair.json'
export const TESTNET_VALIDATOR_VOTE_KEY = 'testnet-vote-account-keypair.json'
export const TESTNET_VALITATOR_AUTHORITY_KEY = 'testnet-authority-keypair.json'

// Validayor Key Paths
export const SOLV_HOME = '/home/solv'
export const IDENTITY_KEY_PATH = `${SOLV_HOME}/${IDENTITY_KEY}`
export const UNSTAKED_KEY_PATH = `${SOLV_HOME}/${UNSTAKED_KEY}`
export const MAINNET_VALIDATOR_KEY_PATH = `${SOLV_HOME}/${MAINNET_VALIDATOR_KEY}`
export const MAINNET_VALIDATOR_VOTE_KEY_PATH = `${SOLV_HOME}/${MAINNET_VALIDATOR_VOTE_KEY}`
export const MAINNET_VALITATOR_AUTHORITY_KEY_PATH = `${SOLV_HOME}/${MAINNET_VALITATOR_AUTHORITY_KEY}`
export const TESTNET_VALIDATOR_KEY_PATH = `${SOLV_HOME}/${TESTNET_VALIDATOR_KEY}`
export const TESTNET_VALIDATOR_VOTE_KEY_PATH = `${SOLV_HOME}/${TESTNET_VALIDATOR_VOTE_KEY}`
export const TESTNET_VALITATOR_AUTHORITY_KEY_PATH = `${SOLV_HOME}/${TESTNET_VALITATOR_AUTHORITY_KEY}`

// Log Path
export const LOG_PATH = `${SOLV_HOME}/solana-validator.log`

// Startup Script Path
export const STARTUP_SCRIPT = SOLV_HOME + '/start-validator.sh'

// Ledger, Account, Snapshots Paths
export const LEDGER_PATH = '/mnt/ledger'
export const ACCOUNTS_PATH = '/mnt/accounts'
export const SNAPSHOTS_PATH = '/mnt/snapshots'

// SOLANA VALIDATOR CLI
export const SOLANA_VALIDATOR = 'solana-validator'
export const AGAVE_VALIDATOR = 'agave-validator'

export const DEFAULT_VALIDATOR_VOTE_ACCOUNT_PUBKEY =
  'ELLB9W7ZCwRCV3FzWcCWoyKP6NjZJKArLyGtkqefnHcG'

export const EPOCH_TIMER_FILE_PATH = '/home/solv/currentEpoch.json'
export const MINIMUM_VALIDATOR_BALANCE = 0.5
export const MAX_RETRIES = 3

// Endpoint
export const SOLANA_TESTNET_RPC_URL = 'https://api.testnet.solana.com'
export const SOLANA_MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com'
export const VS_UPLOAD_ENDPOINT =
  'https://verify.validators.solutions/solv-migrate'
export const JUPITER_ENDPOINT = 'https://jup.validators.solutions/v1/jup'

export enum SWAP_TOKEN {
  SOL = 'SOL',
  USDC = 'USDC',
  elSOL = 'elSOL',
  JitoSOL = 'JitoSOL',
  mSOL = 'mSOL',
  bSOL = 'bSOL',
  EPCT = 'EPCT',
  JUP = 'JUP',
  BONK = 'BONK',
  JTO = 'JTO',
}

export const SWAP_TOKENS = Object.values(SWAP_TOKEN)

// SPL Token Mint
export const SOL_TOKEN_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_TOKEN_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const ELSOL_TOKEN_MINT = 'ELSoL1owwMWQ9foMsutweCsMKbTPVBD9pFqxQGidTaMC'
export const EPCT_TOKEN_MINT = 'CvB1ztJvpYQPvdPBePtRzjL4aQidjydtUz61NWgcgQtP'
export const SOLV_SWAP = 'SOLV420'

export const AssociationAccount = {
  So11111111111111111111111111111111111111112:
    '4Vwkpk3DTVrTGnUQTazsgQ1wxtU9QwZTmAXDaQRHg9Ra',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:
    'J8sqx9ZEoPRqboFAXK3c1R38zm41tRNJgUn2FzyeYQDj',
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn:
    'HPj87TFMPZfm5nk1HmTH9a382RXn7h9oWftiFr3Xs12a',
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So:
    '8CX5tE9KvJ59HcoXwWf6tCZoRuz2JFSmunnbKC1ryaK9',
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1:
    '782MdvLby3VfvKdfDYn9tX3DfNAtg7TcytNNFuepcoMH',
  CvB1ztJvpYQPvdPBePtRzjL4aQidjydtUz61NWgcgQtP:
    'BhR2L6J5q3xF1TxReXyHjaUh4MF6qV99tMsipzPAKeB',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN:
    '212yg3Ev7khq4p1mESFGenF4nWefmkbC8f7mHM68j4vg',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263:
    '61Ndjv9392jPRVGALdYgjjxGYa6TT6Gn2WLDSsmugE6U',
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL:
    '2c9qVh8RQ6j2E2VdAEcCrRXMrd6g1vvPNZvAR6sbaGWo',
}

export const TESTNET_KNOWN_VALIDATORS = [
    'adreoi6W1MGA7eegERNcQTwQH3UuJaAnWjVZEq2cxcF',
    'naterTR45j7aWs16S3qx8V29CfM314dzfvtCSitiAYi',
    'th734sEwvZZ5XfemLcvo6TXepPfawWBjz3HMYeQdhPi',
    'BAPExw4zFmwSUjyPfQorenucofeafHLUetcoWTB4Gwnt',
    'bay3c7G89NTxSULyM45gqJx3JoWtBBeXHvifCywwiwZ',
    'BeRTyZTveVQsekrF63WhFvfGiABThym95x8uZaicDPgo',
    'EF8o3aQnu853EEPJKUfqAgoa8szkVs28sv64xtBrRPSV',
    'chrtyETASKQhsndRM9pr6qC3gAHG5MuRwCgXSNVqnJL',
    'GsVJ62qt2nbRLT4f67LAo6Ve8eGhChJquYaK3wT1iG2v',
    'ctz4yB16kvGiMrA4vdtKXEMYgkkfJLo6hMwDk9DZ3Vf',
    'PARaNF4kcQW3BmaeMD3ELLAqUV7MDS8bMudaCEZ72NM',
    'dedxpgLN1VXLHpekKra1JKkMGrw7tW1uuYz7Ec28iLK',
    'DegEnNCbn6PrsvHvsErneRNv7KFTwnjW3uFVjf43e28v',
    'Dcky7CK3aEHzdV9EF5YR1NaTJ9QfSyzW5cACbqEFKZNv',
    'dksYs1gzQ7FzqyadN5XtcaeVbqKSN7X2SpfN3fcUW7G',
    'dstCt4sDCQx1QFFJekmM5RjyFLsDRkaEjTgXd5gbpDB',
    'eyeYaqg9e2L6xw7YwsSLm27eWJfhLNAm6ETQm8TXNoK',
    'ExCHpAsqeaDJGfUj41bhU2BuZK4fhRnJKvhG486rfKg',
    'farmoWMKdJBxLxhMZpgU1uVjvjVJnQqrGhwAyDmcn8R',
    'G1EaM8gLQU7DifPnCTQKP2PLvFf63tHvaXBAR8QFLg5Z',
    'goJirTtcRjP6Wqkw7cHNvzjEva5rpvPDtj2ZnEmPAr6',
    'wetfCN7bhjhBT8GTSAnah8ftoRoHB8H8Q87KkxDdRgK',
    '8H6qQ2FKUjY8wmggSKHUENY38Nr9sQxDUbEZB6fiCHSX',
    'hy1oTqvrknqoNmPWq2JtQMdDDnWkEGH2ab7N4r4rnJJ',
    'jntrbAHjcxhP2eRUgCSACb6cMVhYm3jEQ3eQDZKicmz',
    'akicJSdNFWszP2Le38t1NtVeywXtvoxdiGciaELwZHz',
    '1i1yarXXz55VdvVL4v2HXcjMJPAv4fWJhY8x43bmwfL',
    'LoV31z7KC5CZ8sdGovmRSDGB6csP1fJip1hiM7xDozw',
    'magiCagux3C7nMKo2jKSbX6yWzYWMGKJ6ABRnw1zQ8U',
    'JAfBCSxx2fZwdM5wTiLRAfJm3MpqXz3KnxjPhCQixGVh',
    'mythT638QB6T8rqcGS4aKZ5a5z31xakTsRC6CL9KGEe',
    'phz4F5mHZcZGC21GRUT6j3AqJxTUGDVAiCKiyucnyy1',
    'pineBbb5K6SdV6KG1xibsR5DM1XsWuajtXSy3YYGY4N',
    'prt1stdbFCFXpEcx9rxwJK63zhYo43V5JCXzGWXkPGn',
    'rad1u8GKZoyVWxVAKy1cjL84dqhS9mp57uAezPt4iQg',
    'rapTWQhZD2dPjJ91BXW4UnVKBt6NvX2aZxWSSYg66Y4',
    'royLQKzrsSs9VbMZMDjZkMM8j3buBnwx7oH3wdifAk4',
    'CitYBuKSE5W6CXEBAgY1B9fEMUdHXYSmZbXbAWd31Cr',
    'axyaGn2eZM1dnDCagpd9aYa92gKWTrtEYb8vwc21ddr',
    'sTeV1NswjBBo15qosoyQj1aYrgvoxomAduN1zFV6gCf',
    'txtXxyX13G7h899vnZwNJsVRAMfWcwYZNT3jucRqqiW',
    'hxTzWqz2WMdLhbMgYfsWiWYdtx8pY582FKwQpfGL59M',
    'te1emnh77qnpsdjcCi9FsyX8t4gf4HYWC4kTVHuH4MQ',
    'tstidz7tN8armqvZ7ia2ck62mY9RD2BrwMtW2w8hcwk',
    'vnd1sXYmA8YY9xHQBkKKurZeq7iCe6EQ9bGYNZJwh1c',
    'YE11vEiXKKx95onU1EpjgwrHovgXamRTQvY52Mvde8i',
    '5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on',
]

export const MAINNET_KNOWN_VALIDATORS = [
    'adre1Xia7ekGsEqNgHeFc7MYwkfzTQNeJgQmZ2agAKZ',
    'nateKhsYkrVc992UuTfAhEEFQqr2zQfpGg9RafNkxdC',
    'BeRtYZnaaZLFwYQRPaZcxuuHBmyFBSGP32C8Ls5xnrZP',
    'b1ueZK9bWTywN2587zsScyLTaH18wfRfN5W15XnkiqF',
    'chrtyhyeugoiCD3M2kjVmJigLwX7YtNP3YK9HZ1N3F1',
    'chdvWr6T14nqGRFD37KY36dsvhkCtDaufW5rpu3AfHe',
    'CtzN7ysR5rX69qd168Aosbuc83mPozhi81bEHbG7ecNP',
    'parayLyZvwnGjDT2pGqrVn8UDxmNcdNQCE8uPRWMeRz',
    'dmMwc4RazLHkvDZYrWAfbHQ6cViAvNa5szCJKaiun8S',
    'DEgenZMznWXvg5YHaZM75arVTauV453SeXX1UrxcGNup',
    'dst2u7mXMyDvb14cSErRNA1mxH1d5VXbSXgZ3DKE9xH',
    'eyeY8HangkSYirSBtopAfThXzhHL855wPnddz8WnemV',
    'ExCHWgfeJyKRzpfryiQn4W6aYaWhbSAEnsoUnBGNqjWD',
    'G1eAmANVWf6ZeoxG4aMbS1APauyEDHqLxHFytzk5hZqN',
    'wetkjRRRDrSPAzHqfVHtFDbhNnejKm5UPfkHeccFCpo',
    'hnhCMmnrmod4rcyc3QRKkLEC9XnPTvYJ2gBvjgFiV4o',
    'hy1oMaD3ViyJ8i6w1xjP79zAWBBaRd1zWdTW8zYXnwu',
    'jntr1vkzvSujfckGR6ANmFmirVoPBMNr5XJGKP5uDQA',
    'NATsUSZGohWw8xtLdxG4yus21UCkaes4FLfM2eqKbRk',
    '1i1yPyh843bTfi5qPgqozTbDcEX65rUNEFcUT2KAs2i',
    'Love31pnbDJNVzZZVbtV4h2ftvTPVcBpXW11BSTCa6s',
    'MagiCBYNPD9iTBXqiFybAFCREQzG6MSM4LmFLXQZxuV',
    'D8xKNftHzFcCekENuTEcFC1eoL9y8wNHEg4Q5z57KK4e',
    'mythxvB89eT3C1TKwwhsvdHfYq2aoCt2es8vLoDFYyk',
    'phz1CRbEsCtFCh2Ro5tjyu588VU1WPMwW9BJS9yFNn2',
    'pineXRUnbaLNFMxaM3zBmFfTiKgQMGqT9jYHXZWq2Fw',
    'prt1st4RSxAt32ams4zsXCe1kavzmKeoR7eh1sdYRXW',
    'radM7PKUpZwJ9bYPAJ7V8FXHeUmH1zim6iaXUKkftP9',
    'rapXHroUoGG3KvZ3qwjvGMdA7siWXwXpiNC1bYarvSC',
    'RoYLttggWwa2st3KAGEjnPhsq4NPD5QwaNVyyR8pTz4',
    'ciTyjzN9iyobidMycjyqRRM7vXAHXkFzH3m8vEr6cQj',
    'axy3tCRL3wmFMVG4c69rYurcf4fXhBo2RcuBj9ADnJ4',
    'sTEVErNNwF2qPnV6DuNPkWpEyCt4UU6k2Y3Hyn7WUFu',
    'TxtxXzLTDQ9W4ya3xgwyaqVa6Tky6Yqhi5BLpPCc9tZ',
    'hxMhrsuGPDmkLJ4mTxEjyeMST3VGhTiwJvS9XgHwePj',
    'te1ee9rGf369wxYQkuxkvuvMuTJ9cksgZySmNUF8rNY',
    'UNrgBLmc8JT6A3dxXY9DWeHvDezt2DZQbhg1KPQfqEL',
    'vnd1Ps8w3fsi54qUMJxBhUWARES34Qw7JQXDZxvbysd',
    'YE11a5nVJtUNqsojkphYuWc7StqBzbCeFH6BjhAAUEV',
    'Certusm1sa411sMpV9FPqU5dXAYhmmhygvxJ23S6hJ24',
    '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2',
    'GdnSyH3YtwcxFvQrVVJMm1JhTS4QVX7MFsX56uJLUfiZ',
    'CakcnaRDHka2gXyfbEd2d3xsvkJkqsLw2akB3zsN1D2S',
]
