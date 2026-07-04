import React, { useState, useEffect, useCallback } from 'react';

type CellValue = 'X' | 'O' | null;
type GameStatus = 'playing' | 'won' | 'draw';

interface TicTacToeProps {
    compact?: boolean; // For dashboard integration
}

const TicTacToe: React.FC<TicTacToeProps> = ({ compact = false }) => {
    const [board, setBoard] = useState<CellValue[]>(Array(9).fill(null));
    const [isXNext, setIsXNext] = useState(true);
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [winner, setWinner] = useState<CellValue>(null);
    const [scores, setScores] = useState({ player: 0, ai: 0, draws: 0 });

    // Calculate winner
    const calculateWinner = (squares: CellValue[]): CellValue => {
        const lines = [
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8],
            [0, 3, 6],
            [1, 4, 7],
            [2, 5, 8],
            [0, 4, 8],
            [2, 4, 6],
        ];
        
        for (let i = 0; i < lines.length; i++) {
            const [a, b, c] = lines[i];
            if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
                return squares[a];
            }
        }
        return null;
    };

    // AI minimax algorithm
    const getBestMove = (squares: CellValue[]): number => {
        const minimax = (board: CellValue[], depth: number, isMaximizing: boolean): number => {
            const currentWinner = calculateWinner(board);
            
            if (currentWinner === 'O') return 10 - depth; // AI wins
            if (currentWinner === 'X') return depth - 10; // Player wins
            if (board.every(cell => cell !== null)) return 0; // Draw
            
            if (isMaximizing) {
                let bestScore = -Infinity;
                for (let i = 0; i < 9; i++) {
                    if (board[i] === null) {
                        board[i] = 'O';
                        const score = minimax(board, depth + 1, false);
                        board[i] = null;
                        bestScore = Math.max(score, bestScore);
                    }
                }
                return bestScore;
            } else {
                let bestScore = Infinity;
                for (let i = 0; i < 9; i++) {
                    if (board[i] === null) {
                        board[i] = 'X';
                        const score = minimax(board, depth + 1, true);
                        board[i] = null;
                        bestScore = Math.min(score, bestScore);
                    }
                }
                return bestScore;
            }
        };

        let bestScore = -Infinity;
        let bestMove = 0;
        
        for (let i = 0; i < 9; i++) {
            if (squares[i] === null) {
                squares[i] = 'O';
                const score = minimax(squares, 0, false);
                squares[i] = null;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = i;
                }
            }
        }
        
        return bestMove;
    };

    // AI move effect
    useEffect(() => {
        if (!isXNext && gameStatus === 'playing') {
            const timer = setTimeout(() => {
                const emptySquares = board.map((val, idx) => val === null ? idx : null).filter(val => val !== null);
                
                if (emptySquares.length === 0) return;
                
                const bestMove = getBestMove([...board]);
                const newBoard = [...board];
                newBoard[bestMove] = 'O';
                
                const gameWinner = calculateWinner(newBoard);
                if (gameWinner) {
                    setWinner(gameWinner);
                    setGameStatus('won');
                    setScores(prev => ({ ...prev, ai: prev.ai + 1 }));
                } else if (newBoard.every(cell => cell !== null)) {
                    setGameStatus('draw');
                    setScores(prev => ({ ...prev, draws: prev.draws + 1 }));
                } else {
                    setIsXNext(true);
                }
                
                setBoard(newBoard);
            }, 600);
            
            return () => clearTimeout(timer);
        }
    }, [isXNext, gameStatus, board]);

    const handleClick = (index: number) => {
        if (board[index] || !isXNext || gameStatus !== 'playing') return;
        
        const newBoard = [...board];
        newBoard[index] = 'X';
        
        const gameWinner = calculateWinner(newBoard);
        if (gameWinner) {
            setWinner(gameWinner);
            setGameStatus('won');
            setScores(prev => ({ ...prev, player: prev.player + 1 }));
            setBoard(newBoard);
            return;
        }
        
        if (newBoard.every(cell => cell !== null)) {
            setGameStatus('draw');
            setScores(prev => ({ ...prev, draws: prev.draws + 1 }));
            setBoard(newBoard);
            return;
        }
        
        setBoard(newBoard);
        setIsXNext(false);
    };

    const resetGame = () => {
        setBoard(Array(9).fill(null));
        setIsXNext(true);
        setGameStatus('playing');
        setWinner(null);
    };

    const resetScores = () => {
        setScores({ player: 0, ai: 0, draws: 0 });
        resetGame();
    };

    const renderCell = (index: number) => {
        const value = board[index];
        const cellSize = compact ? 'w-12 h-12 text-lg' : 'w-20 h-20 text-2xl';
        
        return (
            <button
                key={index}
                onClick={() => handleClick(index)}
                className={`${cellSize} border-2 border-[var(--border-color)] font-bold transition-all duration-200 transform hover:scale-105 ${
                    value === 'X' ? 'text-blue-500' : value === 'O' ? 'text-red-500' : ''
                } ${gameStatus !== 'playing' && !value ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--primary-color)]/10'}`}
                disabled={gameStatus !== 'playing' || value !== null}
                style={{
                    backgroundColor: value ? 'var(--surface)' : 'transparent',
                    borderRadius: '8px'
                }}
            >
                {value}
            </button>
        );
    };

    return (
        <div className={`flex flex-col items-center justify-center gap-4 p-6 rounded-xl bg-[var(--background-card)] border border-[var(--border-color)]/50`} style={{
            backgroundColor: 'rgba(var(--surface-rgb), 0.5)'
        }}>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">
                Tic Tac Toe
            </h2>

            {/* Scores */}
            {!compact && (
                <div className="flex gap-6 text-sm">
                    <div className="text-center">
                        <div className="text-blue-500 font-bold text-lg">{scores.player}</div>
                        <div className="text-[var(--text-secondary)] text-xs">You</div>
                    </div>
                    <div className="text-center">
                        <div className="text-gray-400 font-bold text-lg">{scores.draws}</div>
                        <div className="text-[var(--text-secondary)] text-xs">Draws</div>
                    </div>
                    <div className="text-center">
                        <div className="text-red-500 font-bold text-lg">{scores.ai}</div>
                        <div className="text-[var(--text-secondary)] text-xs">AI</div>
                    </div>
                </div>
            )}

            {/* Board */}
            <div className={`grid grid-cols-3 gap-2 ${compact ? 'scale-75 origin-top' : ''}`}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => renderCell(i))}
            </div>

            {/* Status */}
            <div className="text-center h-8">
                {gameStatus === 'playing' ? (
                    <div className="text-[var(--text-secondary)] text-sm">
                        {isXNext ? "🔵 Your Turn" : "🤖 AI is thinking..."}
                    </div>
                ) : gameStatus === 'won' ? (
                    <div className={`text-lg font-bold ${winner === 'X' ? 'text-blue-500' : 'text-red-500'}`}>
                        {winner === 'X' ? '🎉 You Won!' : '😢 AI Won!'}
                    </div>
                ) : (
                    <div className="text-[var(--text-secondary)] font-semibold">
                        🤝 It's a Draw!
                    </div>
                )}
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
                <button
                    onClick={resetGame}
                    className="px-4 py-2 bg-[var(--primary-color)] text-white rounded-lg font-semibold text-sm hover:opacity-80 transition-opacity"
                >
                    New Game
                </button>
                {!compact && (
                    <button
                        onClick={resetScores}
                        className="px-4 py-2 bg-[var(--text-secondary)]/20 text-[var(--text-secondary)] rounded-lg font-semibold text-sm hover:bg-[var(--text-secondary)]/30 transition-colors"
                    >
                        Reset Scores
                    </button>
                )}
            </div>
        </div>
    );
};

export default TicTacToe;
