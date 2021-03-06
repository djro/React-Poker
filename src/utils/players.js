import { handlePhaseShift, reconcilePot, anteUpBlinds, determineBlindIndices } from './bet.js';
import { dealMissingCommunityCards, showDown, generateDeckOfCards, shuffle, dealPrivateCards } from './cards.js';

const axios = require('axios')
// TODO Generate UUID to simulate User ID and really get a perf match on binding to players when determining winnings
const generateTable = async () => {
	const users = [{
		name: 'Player 1',
		avatarURL: '/assets/boy.svg',
		cards: [],
		showDownHand: {
			hand: [],
			descendingSortHand: [], 
		},
		chips: 20000,
		chipsInvested: 0,
		roundStartChips: 2000,
		bet: 0,
		betReconciled: false,
		folded: false,
		canRaise: true,
		stackInvestment: 0,
		robot: false
	}];

	const response = await axios.get(`https://randomuser.me/api/?results=4&nat=us,gb,fr`);
	let randomUsers = response.data.results
		.map(user => ({ 
			name: `${user.name.first.charAt(0).toUpperCase()}${user.name.first.slice(1)} ${user.name.last.charAt(0).toUpperCase()}${user.name.last.slice(1)}`,
			avatarURL: user.picture.large,
			cards: [],
			chips: Math.floor(Math.random() * (20000 - 18000)) + 18000,
			chipsInvested: 0,
			roundStartChips: 2000,
			showDownHand: {
				hand: [],
				descendingSortHand: [],
			},
			bet: 0,
			betReconciled: false,
			folded: false,
			robot: true,
			canRaise: true,
			stackInvestment: 0,
		}))
		.forEach(user => users.push(user))

	return users
}

const generatePersonality = (seed) => {
	switch(seed) {
		case (seed > 0.5): 
			return 'standard'
		case (seed > 0.35): 
			return 'aggressive'
		case (seed > 0):
		default: 
			return 'conservative'
	}
}

const handleOverflowIndex = (currentIndex, incrementBy, arrayLength, direction) => {
	switch (direction) {
		case('up'): {
			return (
				(currentIndex + incrementBy) % arrayLength
			)
		}
		case('down'): {
			return (
				((currentIndex - incrementBy) % arrayLength) + arrayLength 
			)
		}
	}
}

const determinePhaseStartActivePlayer = (state, recursion = false) => {
	if (!recursion) {
		state.activePlayerIndex = handleOverflowIndex(state.blindIndex.big, 1, state.players.length, 'up');
	} else if (recursion) {
		state.activePlayerIndex = handleOverflowIndex(state.activePlayerIndex, 1, state.players.length, 'up');
	}
		if (state.players[state.activePlayerIndex].folded) {
			return determinePhaseStartActivePlayer(state, true)
		}
		if (state.players[state.activePlayerIndex].chips === 0) {
			return determinePhaseStartActivePlayer(state, true)
		}
				return state
}

const determineNextActivePlayer = (state) => {
	state.activePlayerIndex = handleOverflowIndex(state.activePlayerIndex, 1, state.players.length, 'up')
	if (state.numPlayersActive ===  1) {
		return(showDown(reconcilePot(dealMissingCommunityCards(state))))
	}
	if (state.players[state.activePlayerIndex].folded) {
		return determineNextActivePlayer(state);
	}
	if (state.players[state.activePlayerIndex].chips === 0) {
		if (state.numPlayersAllIn === state.numPlayersActive) {
			return(showDown(reconcilePot(dealMissingCommunityCards(state))))
		} else {
			return determineNextActivePlayer(state);
		}
	}
	// IF a player is all in, he will be reconciled?
	if (state.players[state.activePlayerIndex].betReconciled) {
		return handlePhaseShift(state);
	}

		const skipToShowDown = checkEdgeCasesRequiringShowdown(state)
			// console.log("There are no bets:", (state.players.map(pl => pl.bet).filter(activeBets => activeBets > 0).length === 0))

		if (skipToShowDown) {
			console.log("Action on player, but all other players are all-in, no bets to call. Skipping to showdown")
			return(showDown(reconcilePot(dealMissingCommunityCards(state))))
		}

		return state
}

const checkEdgeCasesRequiringShowdown = (state) => {
	const checklit = (state.numPlayersActive - state.numPlayersAllIn === 1)
	const playerBets = state.players.map(pl => pl.bet)
	const activeBets = playerBets.filter(betValue => betValue > 0)
		// console.log("Checking for Lituation: Are we in a possible twist of having all but one player all-in?", checklit)
			// console.log(playerBets)
			// console.log(activeBets)
			// console.log("Checking if only 1 player with chips is in...in a roundabout fashion. Well, just by looking at active players")

			if (checklit && activeBets.length === 0) {
				return true
			}

			return false
}

const passDealerChip = (state) => {
	// This is messy because we are determining active player, dealer, and blinds based on an arbitrary index, not with flags on player entries.
	// When we remove all players who have ran out of chips, the new indices will not match up cleanly. We need to find the index of the player, keep track of who it is or 
	state.dealerIndex = handleOverflowIndex(state.dealerIndex, 1, state.players.length, 'up');
	const nextDealer = state.players[state.dealerIndex]
	if (nextDealer.chips === 0) {
		return passDealerChip(state)
	}

		return filterBrokePlayers(state, nextDealer.name);
}

const filterBrokePlayers = (state, dealerID) => {
	state.players = state.players.filter(player => player.chips > 0);
	const newDealerIndex = state.players.findIndex(player => player.name === dealerID)
	state.dealerIndex = newDealerIndex
	state.activePlayerIndex = newDealerIndex
	if (state.players.length === 1) {
		// Victory!
		return state
	} else if (state.players.length === 2) {
		// Need to refine rules for who goes first when 2 players are left
		// Can move this logic to our determineBlindIndices fn
		state.blindIndex.small = newDealerIndex;
		state.blindIndex.big = handleOverflowIndex(newDealerIndex, 1, state.players.length, 'up');
		state.players = anteUpBlinds(state.players, { bigBlindIndex: state.blindIndex.big, smallBlindIndex: state.blindIndex.small }, state.minBet).map(player => ({
			...player,
			cards:[],
			showDownHand: {
				hand: [],
				descendingSortHand: [],
			},
			betReconciled: false,
			folded: false,
		}))
		state.numPlayersAllIn = 0;
		state.numPlayersFolded = 0;
		state.numPlayersActive = state.players.length;
	} else {
		const blindIndicies = determineBlindIndices(newDealerIndex, state.players.length);
		state.blindIndex = {
        	big: blindIndicies.bigBlindIndex,
        	small: blindIndicies.smallBlindIndex,
      	}
		state.players = anteUpBlinds(state.players, blindIndicies, state.minBet).map(player => ({
			...player,
			cards: [],
			showDownHand: {
				hand: [],
				descendingSortHand: [],
			},
			betReconciled: false,
			folded: false,
		}))
		state.numPlayersAllIn = 0; // May need to alter this is big/small blind brings a player all in
		state.numPlayersFolded = 0;
		state.numPlayersActive = state.players.length;
	}
		return dealPrivateCards(state)
}

const beginNextRound = (state) => {
	state.communityCards = [];
	state.sidePots = [];
	state.deck = shuffle(generateDeckOfCards())
	state.highBet = 20;
	state.minBet = 20; // can export out to initialState
	// Unmount all cards so react can re-trigger animations
	   const { players } = state
    	const clearPlayerCards = players.map(player => ({...player, cards: player.cards.map(card => {})}))
    	state.players = clearPlayerCards
	return passDealerChip(state)
}

// NEED INITIAL PLAYER STATE
// INITIAL TABLE STATE
export { generateTable, handleOverflowIndex, determineNextActivePlayer, determinePhaseStartActivePlayer, beginNextRound }