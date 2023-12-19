// parameters
const cacheRelayUrl = "wss://cache2.primal.net/v1"; // "wss://cache.follows.lol";
const defaultRelayList = ["wss://relay.primal.net", "wss://relay.follows.lol"];
const userFollowersLimit = 500;

// define our tools
const nt = window.NostrTools;

// reactivity
function disableButton() {
    document
        .getElementById('follow-button')
        .setAttribute('disabled', 'disabled');
}
function enableButton() {
    document
        .getElementById('follow-button')
        .removeAttribute('disabled');
}
// force firefox to disable button until connected
disableButton();

// print log to div
function print(msg, color) {
    const htmlLog = document.getElementById('html-log');
    if (color) {
        msg = `<a style="color:${color};">${msg}</a>`
    }
    // check what we need to output (object or text)
    // and add it to the html element.
    if (typeof msg == 'object') {
        htmlLog.innerHTML += (
            JSON && JSON.stringify ? JSON.stringify(msg) : msg
        ) + '<br>';
    } else {
        htmlLog.innerHTML += msg + '<br>';
    }
    // keep scroll down
    htmlLog.scrollTop = htmlLog.scrollHeight;
}

// read user's relay list if present
async function getRelays() {
    let relayList = defaultRelayList;
    if (window.hasOwnProperty('nostr')) {
        const userRelays = await window.nostr.getRelays();
        for (let r in Object.keys(userRelays)) {
            const relayUrl = Object.keys(userRelays)[r];
            const isWriteable = userRelays[relayUrl].write;
            if (isWriteable) {
                relayList.push(relayUrl);
            }
        }
    }
    return(relayList);
}

// connect to relays concurrently
async function connectRelays() {
    window.relays = [];
    // initialize cache relay connection
    window.cacheRelay = nt.relayInit(cacheRelayUrl);
    cacheRelay.on('connect', () => {
        print(`Connected to cache relay ${cacheRelay.url}`)
    })
    cacheRelay.on('error', () => {
        print(
            "Couldn't connect to cache server.\n" +
            "Please try reloading the page.", 'Red'
        );
        throw new TypeError(`Failed to connect to ${cacheRelay.url}`);
    })
    // handle regular relays
    print('Connecting to relays...');
    let promises = [cacheRelay.connect()];
    const relayList = await getRelays();
    let noRelayAvailable = true;
    for ( let r in relayList ) {
        // initialize relay connection
        const url = relayList[r];
        window.relays[r] = nt.relayInit(url);
        relays[r].on('connect', () => {
            print(`Connected to relay ${url}`);
            noRelayAvailable = false;
        });
        relays[r].on('error', () => {
            print(
                `Could not connect to relay ${url}.`,
                'DarkOrange'
            );
        });
        // connect promise
        promises.push(relays[r].connect());
    }
    // concurrency
    await Promise.allSettled(promises);
    // stop if we got no relay
    if (noRelayAvailable) {
        print(
            `Could not connect to any regular relay.\n` +
            `Please try reloading the page.`,
            'Red'
        );
        throw new TypeError(`Failed to connect to relay(s).`);
    }
    // reactivity
    enableButton();
    print('Ready.');
}

function getTargetFollowers(targetUserPubkey, success) {
    print('Getting target followers...');
    const filter = {
        "cache": [
            "user_followers",
            { "pubkey": targetUserPubkey, "limit": userFollowersLimit }
        ]
    }
    const sub = cacheRelay.sub([filter]);
    let followers = [];
    sub.on('event', event => {
        if (event.kind === 0) {
            followers.push(["p", event.pubkey]); // match contact list format
        }
    });
    sub.on('eose', () => {
        sub.unsub()
        print('Target followers: ' + followers.length);
        success(followers);
    });
}
// wrap function above in a promise
function getTargetFollowersPromise(targetUserPubkey) {
    return new Promise((result) => {
        getTargetFollowers(targetUserPubkey, (success) => {
            result(success);
        })
    });
}

function getContactListEvent(userPubkey, label, success) {
    // the label should be either "own" or, for exmaple, 
    // "target user's"
    print(`Getting ${label} contact list...`);
    const filter = {
        "authors": [userPubkey],
        "kinds": [3],
        "limit": 1
    }
    const sub = relays[0].sub([filter]);
    sub.on('event', event => {
        let eventValidation = nt.verifySignature(event);
        if (eventValidation !== true) {
            throw new TypeError("We received a fake event!");
        } else {
            print(`Contact list size (${label}): ` + event.tags.length);
            success(event);
        }
    });
    sub.on('eose', () => {
        sub.unsub()
    });
}
// wrap function above in a promise
function getContactListEventPromise(userPubkey, label) {
    return new Promise((result) => {
        getContactListEvent(userPubkey, label, (success) => {
            result(success);
        })
    });
}

function mergeLists(list1, list2) {
    const listSum = list1.concat(list2);
    let listSumPksOnly = [];
    listSum.forEach((i) => { // simplify list format
        listSumPksOnly.push(i[1]);
    });
    let uniqPksOnly = [...new Set(listSumPksOnly)]; // uniq values
    let result = [];
    uniqPksOnly.forEach((i) => {
        result.push([ "p", i ]); // restore original format
    });
    return(result);
}

// sign according to either extension or manual private key mode
async function signEvent(userPrivateKey, event) {
    if (!window.nostr) {
        // nsec mode
        newEvent.sig = nt.getSignature(event, userPrivateKey);
        return(event);
    } else {
        // extension mode
        return(await window.nostr.signEvent(event));
    }
}

// if there is no browser extension present, activate nsec input field
function checkExtensionPresence() {
    if (!window.hasOwnProperty('nostr')) { // no browser extension detected
        console.log('No Nostr browser extension detected.');
        document
            .getElementById('nsec-field')
            .setAttribute('class', 'field');
        window.alert(
            `We were unable to detect a Nostr browser extension.\n` +
            `We just added a field for you to manually enter your private key, which ` +
            `is then stored locally in your browser (it is never sent to us).\n` +
            `Use this option only if you know what you're doing.\n` +
            `If you don't, it is best for you to first get a ` +
            `Nostr browser extension, for example from https://GetAlby.com`
        );
    }
}

// make sure everything is loaded before starting
document.onreadystatechange = () => {
    if (document.readyState === "complete") {
        console.info("Loading complete.");
        // go go go
        checkExtensionPresence();
        connectRelays();
    }
};

async function propagate(event) {
    let promises = [];
    for (let r in relays) {
        promises.push(relays[r].publish(event));
    }
    let statuses = await Promise.allSettled(promises);
    let result = false;
    for (let s in statuses) {
        if (statuses[s].status === "fulfilled") {
            result = true;
        } else {
            print(`Error publishing to relay ${s}.`, 'DarkRed');
        }
    }
    return(result);
}

// main function
async function onSubmit(e) {
    // reactivity stuff
    e.stopImmediatePropagation();
    e.preventDefault();
    disableButton();

    // prepare to get target data
    let targetUserNpub = document.getElementById('npub').value.trim();
    let targetUserPubkey = nt.nip19.decode(targetUserNpub).data;

    // prepare to get user's data
    const wn = window.nostr;
    const userNsec = wn ? null : document.getElementById('nsec').value;
    const userPrivateKey = wn ? null : nt.nip19.decode(userNsec).data;
    const userPubkey = wn ? await wn.getPublicKey() : nt.getPublicKey(userPrivateKey);

    // get data concurrently
    let allPromiseStatuses = await Promise.allSettled([
        getContactListEventPromise(userPubkey, "own"), // ours
        getContactListEventPromise(targetUserPubkey, "target user's"),
        getTargetFollowersPromise(targetUserPubkey)
    ]);
    let contactListEvent = allPromiseStatuses[0].value; // ours
    let contactList = contactListEvent.tags; // ours
    if ( !contactList > 0 ) { // never accidentally remove contacts
        throw new TypeError(`Could not read current contact list.`);
        print(
            `Could not read contact list for pubkey "${userPubkey}".\n` +
            `Please try again refreshing the page.`
        );
    }
    let targetContactList = allPromiseStatuses[1].value.tags;
    let targetFollowers = allPromiseStatuses[2].value;

    // merge the three lists
    print('Consolidating lists...');
    let targetList = mergeLists(targetFollowers, targetContactList);
    let newList = mergeLists(targetList, contactList);
    print('Making new contact list: ' + newList.length);

    // work on new event
    let newEvent = contactListEvent;
    newEvent.created_at = Math.floor(Date.now() / 1000);
    newEvent.tags = newList;
    newEvent.id = nt.getEventHash(newEvent);

    // calculate how many new contacts
    let diff = newList.length - contactList.length;
    if (diff > 0) { // never accidentally remove contacts
        print(`Adding ${diff} new contacts...`, 'DarkOrange');
        // sign the new event
        let signedEvent = await signEvent(userPrivateKey, newEvent);
        // propagate
        //await relays[0].publish(signedEvent);
        const propagationResult = await propagate(signedEvent);
        if (propagationResult) {
            print(`Event published, contact list updated.`);
            print(`<b>Success! Now you follow ${diff} new people.</b>`, 'Green');
        } else {
            print(`Sorry, we couldn't update your contact list.`, 'DarkRed');
        }
    } else {
        print("Sorry, we couldn't find any new people to follow.", 'DarkRed');
    }
    enableButton();
}
document.getElementById('follow-form').addEventListener('submit', onSubmit);

