export type PlayerWithStats = {
  id: string;
  playerStats?: {
    rank: number;
    totalGames: number;
  } | null;
};

const MAX_RANK_DIFFERENCE = 1000;
const MAX_RANK_CHANGE = 30;
const MIN_RANK_CHANGE = 3;
const AVG_RANK_CHANGE = 15;
const RANK_CHANGE_MULTIPLIER = 2;

const getRankChangeByPlayer = (rankChange: number, gamesNumber: number) =>
  gamesNumber >= 10 ? rankChange : rankChange * RANK_CHANGE_MULTIPLIER;

const getMaxRankChange = (isTeam1Favorite: boolean, isTeam1Won: boolean) => {
  if (isTeam1Favorite) {
    return isTeam1Won ? MIN_RANK_CHANGE : -MAX_RANK_CHANGE;
  } else {
    return isTeam1Won ? -MAX_RANK_CHANGE : MIN_RANK_CHANGE;
  }
};

export const getRankChangeByRankDifference = (rankDifference) => {
  if (rankDifference <= 100) {
    return {
      biggerChange: AVG_RANK_CHANGE,
      lowerChange: AVG_RANK_CHANGE,
    };
  }

  if (rankDifference > 100 && rankDifference <= 200) {
    return {
      lowerChange: AVG_RANK_CHANGE - 3, // 12
      biggerChange: AVG_RANK_CHANGE + 3, // 18
    };
  }

  if (rankDifference > 200 && rankDifference <= 300) {
    return {
      lowerChange: AVG_RANK_CHANGE - 4, // 11
      biggerChange: AVG_RANK_CHANGE + 4, // 19
    };
  }

  if (rankDifference > 300 && rankDifference <= 400) {
    return {
      lowerChange: AVG_RANK_CHANGE - 5, // 10
      biggerChange: AVG_RANK_CHANGE + 5, // -20
    };
  }

  if (rankDifference > 400 && rankDifference <= 500) {
    return {
      lowerChange: AVG_RANK_CHANGE - 6, // 9
      biggerChange: AVG_RANK_CHANGE + 6, // -21
    };
  }

  if (rankDifference > 500 && rankDifference <= 600) {
    return {
      lowerChange: AVG_RANK_CHANGE - 7, // 8
      biggerChange: AVG_RANK_CHANGE + 7, // -22
    };
  }

  if (rankDifference > 600 && rankDifference <= 700) {
    return {
      lowerChange: AVG_RANK_CHANGE - 8, // 7
      biggerChange: AVG_RANK_CHANGE + 8, // -23
    };
  }

  if (rankDifference > 700 && rankDifference <= 800) {
    return {
      lowerChange: AVG_RANK_CHANGE - 9, // 6
      biggerChange: AVG_RANK_CHANGE + 9, // -24
    };
  }

  if (rankDifference > 800 && rankDifference <= 900) {
    return {
      lowerChange: AVG_RANK_CHANGE - 11, // 5
      biggerChange: AVG_RANK_CHANGE + 11, // -26
    };
  }

  if (rankDifference > 900 && rankDifference <= 1000) {
    return {
      lowerChange: AVG_RANK_CHANGE - 13, // 4
      biggerChange: -AVG_RANK_CHANGE + 13, // -28
    };
  }
};

export const getRanksChangesByGameResult = (game: {
  id: string;
  team1Points: number;
  team2Points: number;
  team1Player1: PlayerWithStats;
  team1Player2: PlayerWithStats;
  team2Player1: PlayerWithStats;
  team2Player2: PlayerWithStats;
}) => {
  const { team1Player1, team1Player2, team2Player1, team2Player2, team1Points, team2Points } = game;

  const isTeam1Won = team1Points > team2Points;

  // Extract player ranks (use default 1000 if playerStats is null)
  const team1Player1Rank = team1Player1?.playerStats?.rank ?? 1000;
  const team1Player2Rank = team1Player2?.playerStats?.rank ?? 1000;
  const team2Player1Rank = team2Player1?.playerStats?.rank ?? 1000;
  const team2Player2Rank = team2Player2?.playerStats?.rank ?? 1000;

  // Calculate team sums
  const team1Sum = team1Player1Rank + team1Player2Rank;
  const team2Sum = team2Player1Rank + team2Player2Rank;
  const isEqualTeams = team1Sum === team2Sum;
  const isTeam1Favorite = team1Sum > team2Sum;

  // Handle tie games - no rank change
  if (team1Points === team2Points) {
    return;
  }

  // Calculate rank difference
  const rankDifference = Math.abs(team1Sum - team2Sum);

  if (rankDifference > MAX_RANK_DIFFERENCE) {
    return {
      team1Player1Change: getRankChangeByPlayer(
        getMaxRankChange(isTeam1Favorite, isTeam1Won),
        team1Player1.playerStats?.totalGames ?? 0,
      ),
      team1Player2Change: getRankChangeByPlayer(
        getMaxRankChange(isTeam1Favorite, isTeam1Won),
        team1Player2.playerStats?.totalGames ?? 0,
      ),
      team2Player1Change: getRankChangeByPlayer(
        getMaxRankChange(isTeam1Favorite, isTeam1Won),
        team2Player1.playerStats?.totalGames ?? 0,
      ),
      team2Player2Change: getRankChangeByPlayer(
        getMaxRankChange(isTeam1Favorite, isTeam1Won),
        team2Player2.playerStats?.totalGames ?? 0,
      ),
    };
  }

  const { biggerChange, lowerChange } = getRankChangeByRankDifference(rankDifference);
  if (isTeam1Favorite) {
    return {
      team1Player1Change: getRankChangeByPlayer(
        isTeam1Won ? lowerChange : -biggerChange,
        team1Player1.playerStats?.totalGames ?? 0,
      ),
      team1Player2Change: getRankChangeByPlayer(
        isTeam1Won ? lowerChange : -biggerChange,
        team1Player2.playerStats?.totalGames ?? 0,
      ),
      team2Player1Change: getRankChangeByPlayer(
        isTeam1Won ? -lowerChange : biggerChange,
        team2Player1.playerStats?.totalGames ?? 0,
      ),
      team2Player2Change: getRankChangeByPlayer(
        isTeam1Won ? -lowerChange : biggerChange,
        team2Player2.playerStats?.totalGames ?? 0,
      ),
    };
  } else {
    return {
      team1Player1Change: getRankChangeByPlayer(
        isTeam1Won ? biggerChange : -lowerChange,
        team1Player1.playerStats?.totalGames ?? 0,
      ),
      team1Player2Change: getRankChangeByPlayer(
        isTeam1Won ? biggerChange : -lowerChange,
        team1Player2.playerStats?.totalGames ?? 0,
      ),
      team2Player1Change: getRankChangeByPlayer(
        isTeam1Won ? -biggerChange : lowerChange,
        team2Player1.playerStats?.totalGames ?? 0,
      ),
      team2Player2Change: getRankChangeByPlayer(
        isTeam1Won ? -biggerChange : lowerChange,
        team2Player2.playerStats?.totalGames ?? 0,
      ),
    };
  }
};
