const EventEmitter = require('events');
const mongoose = require('mongoose');
const ValidationError = require('../errors/validation');

module.exports = class StarService extends EventEmitter {

    constructor(randomService, nameService, distanceService, starDistanceService, technologyService) {
        super();
        
        this.randomService = randomService;
        this.nameService = nameService;
        this.distanceService = distanceService;
        this.starDistanceService = starDistanceService;
        this.technologyService = technologyService;
    }

    generateUnownedStar(game, name, location, galaxyRadius) {
        let naturalResources = this.randomService.generateStarNaturalResources(galaxyRadius, location.x, location.y, 
            game.constants.star.resources.minNaturalResources, game.constants.star.resources.maxNaturalResources, true);

        return {
            _id: mongoose.Types.ObjectId(),
            name,
            naturalResources,
            location,
            infrastructure: { }
        };
    }

    generateStarPosition(game, originX, originY, radius) {
        if (radius == null) {
            radius = game.constants.distances.maxDistanceBetweenStars;
        }

        return this.randomService.getRandomPositionInCircleFromOrigin(originX, originY, radius);
    }

    getByObjectId(game, id) {
        return game.galaxy.stars.find(s => s._id.equals(id));
    }

    getById(game, id) {
        return game.galaxy.stars.find(s => s._id.toString() === id.toString());
    }

    setupHomeStar(game, homeStar, player, gameSettings) {
        // Set up the home star
        player.homeStarId = homeStar._id;
        homeStar.ownedByPlayerId = player._id;
        homeStar.garrisonActual = gameSettings.player.startingShips;
        homeStar.garrison = homeStar.garrisonActual;
        homeStar.naturalResources = game.constants.star.resources.maxNaturalResources; // Home stars should always get max resources.
        homeStar.warpGate = false;
        
        // ONLY the home star gets the starting infrastructure.
        homeStar.infrastructure.economy = gameSettings.player.startingInfrastructure.economy;
        homeStar.infrastructure.industry = gameSettings.player.startingInfrastructure.industry;
        homeStar.infrastructure.science = gameSettings.player.startingInfrastructure.science;
    }

    getPlayerHomeStar(stars, player) {
        return this.listStarsOwnedByPlayer(stars, player._id).find(s => s._id.equals(player.homeStarId));
    }

    listStarsOwnedByPlayer(stars, playerId) {
        return stars.filter(s => s.ownedByPlayerId && s.ownedByPlayerId.equals(playerId));
    }
    
    getStarsWithinScanningRangeOfStar(game, starId) {
        return this.getStarsWithinScanningRangeOfStarByStars(game, starId, game.galaxy.stars);
    }

    getStarsWithinScanningRangeOfStarByStars(game, starId, stars) {
        // Get all of the stars owned by the player
        let star = this.getById(game, starId);

        if (star.ownedByPlayerId == null) {
            return [];
        }

        let effectiveTechs = this.technologyService.getStarEffectiveTechnologyLevels(game, star);
        let scanningRangeDistance = this.distanceService.getScanningDistance(game, effectiveTechs.scanning);

        // Go through all stars and find each star that is in scanning range.
        let starsInRange = stars.filter(s => {
            return s._id.toString() !== starId.toString() && // Not the current star
                this.starDistanceService.getDistanceBetweenStars(s, star) <= scanningRangeDistance;
        });

        return starsInRange;
    }

    filterStarsByScanningRange(game, player) {
        // Stars may have different scanning ranges independently so we need to check
        // each star to check what is within its scanning range.
        let playerStars = this.listStarsOwnedByPlayer(game.galaxy.stars, player._id);
        let starsToCheck = game.galaxy.stars;
        let starsInRange = [];

        for (let star of playerStars) {
            let stars = this.getStarsWithinScanningRangeOfStar(game, star._id, starsToCheck);

            for (let s of stars) {
                if (starsInRange.indexOf(s) === -1) {
                    starsInRange.push(s);
                    //starsToCheck.splice(starsToCheck.indexOf(s), 1); // TODO: Have to instead clone the game.galaxy.stars otherwise this will screw up the game galaxy.
                }
            }
        }

        return starsInRange;
    }

    isStarInScanningRangeOfPlayer(game, star, player) {
        // Stars may have different scanning ranges independently so we need to check
        // each star to check what is within its scanning range.
        let playerStars = this.listStarsOwnedByPlayer(game.galaxy.stars, player._id);
        let starsToCheck = game.galaxy.stars;

        for (let playerStar of playerStars) {
            let stars = this.getStarsWithinScanningRangeOfStar(game, playerStar._id, starsToCheck);

            if (stars.indexOf(star) > -1) {
                return true;
            }
        }

        return false;
    }

    calculateTerraformedResources(naturalResources, terraforming) {
        return (terraforming * 5) + naturalResources;
    }

    calculateStarShipsByTicks(techLevel, industryLevel, ticks = 1) {
        // A star produces Y*(X+5) ships every 24 ticks where X is your manufacturing tech level and Y is the amount of industry at a star.
        return +((industryLevel * (techLevel + 5) / 24) * ticks).toFixed(2);
    }

    async abandonStar(game, player, starId) {
        // Get the star.
        let star = game.galaxy.stars.find(x => x.id === starId);

        // Check whether the star is owned by the player
        if ((star.ownedByPlayerId || '').toString() !== player.id) {
            throw new ValidationError(`Cannot abandon a star that is not owned by the player.`);
        }

        star.ownedByPlayerId = null;
        star.garrisonActual = 0;
        star.garrison = star.garrisonActual;
        
        game.galaxy.carriers = game.galaxy.carriers.filter(x => (x.orbiting || '').toString() != star.id);

        // TODO: Re-assign home star?
        // // If this was the player's home star, then we need to find a new home star.
        // if (star.homeStar) {
        //     let closestStars = this.starDistanceService.getClosestPlayerOwnedStars(star, game.galaxy.stars, player);

        //     if (closestStars.length) {
        //         closestStars[0].homeStar = true;
        //     }
        // }
        
        await game.save();

        this.emit('onPlayerStarAbandoned', {
            game,
            player,
            star
        });
    }

    canTravelAtWarpSpeed(starA, starB) {
        return starA.warpGate && starB.warpGate && starA.ownedByPlayerId && starB.ownedByPlayerId;
    }

}